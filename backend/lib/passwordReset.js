// Tokenised password reset: minting, burning, redeeming, and the one function
// in the codebase that writes a passwordHash.
//
// This replaces POST /api/auth/forgot-password as it was — a route that took
// { email, newPassword } and set that user's password with no token, no email,
// no proof the caller owned the mailbox, and (until recently) on by default.
// That was unauthenticated account takeover of every workspace on every
// install, and it voided the current-password check on /api/auth/password
// entirely: anyone with a session never needed your old password, because the
// public route would hand them a new one.
//
// NOT the Node 24 global `crypto`. That is WebCrypto, which has neither
// randomBytes nor createHash — omitting this import fails at runtime, not at
// lint. backend/lib/webhookVerify.js imports it the same way.
import crypto from 'node:crypto';
import { prisma } from './db.js';
import { hashPassword } from './auth.js';
import { invalidateSessionCache } from './sessions.js';
import { isUnreachableUrl } from './urlReachability.js';
import { isDemoMode } from './setupStatus.js';
import { resolveSender } from './sender.js';
import { getProvider } from './providers/index.js';
import { escapeHtml } from './html.js';

// Module constants, deliberately NOT env vars. Every knob on a security
// control is a knob someone eventually sets to thirty days to stop the support
// tickets, and the defensible range for a mailed credential is 15–60 minutes.
// Exported so the UI copy and the tests read the same number instead of
// retyping it — copy that contradicts behaviour is indistinguishable from a
// broken feature.
export const RESET_TOKEN_TTL_MINUTES = 60;
const TTL_MS = RESET_TOKEN_TTL_MINUTES * 60_000;

// Per-ADDRESS throttles, which is a different question from express-rate-limit.
// authLimiter keys on req.ip, and the victim of a reset flood is the MAILBOX
// OWNER, not the requester: an attacker on a residential proxy pool rotates
// addresses and stays well under 20-per-15-minutes from every one of them
// while the target's inbox fills up.
//
// The state therefore has to be shared between processes and survive restarts.
// lib/sessions.js already documents that this app has no shared cache, and
// deploy.sh pm2-restarts on every deploy, so an express-rate-limit MemoryStore
// would reset to zero on each. Postgres is the only shared durable store
// present, and the counter is a query over rows we are already writing.
//
// The ceiling matters for a second reason: both instances may share one
// BREVO_API_KEY on a 300/day free tier (see docs/SECOND-INSTANCE.md), so reset
// mail competes for quota with real campaign sends.
const SEND_COOLDOWN_MS = 60_000;
const SENDS_PER_HOUR = 3;

// Expired rows are kept a day past expiry before the sweep removes them, so a
// support question ("did a reset even go out?") has something to look at.
const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;

// 32 random bytes in base64url is exactly 43 characters. Pinned as a regex
// because the handler shape-checks before touching the database.
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

// 256 bits from the CSPRNG.
//
// Never randomUUID(): ~122 bits, and being hex-with-dashes it needs no
// encoding thought, which is exactly why people reach for it. Never a JWT: a
// JWT is stateless by construction and therefore unburnable — lib/sessions.js
// exists precisely because JWTs cannot be revoked without server-side state,
// and a reset token is a credential that MUST be revocable.
function mintToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

// Unsalted sha256. The hash IS the lookup key: we hash what was presented and
// ask a unique index for an exact match, so there is no "fetch the row, then
// compare the secret" step for a timing side channel to live in. bcrypt would
// be wrong here — it salts per row, so the digest is not a function of the
// token alone and the indexed lookup becomes a table scan plus a comparison.
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Every invalidation in this feature is a burn, never a delete: the row has to
// survive so the per-user hourly counter still has its own evidence to count.
// `client` is either `prisma` or a transaction handle.
export async function burnOutstanding(client, userId) {
  const { count } = await client.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count;
}

// The only place in the codebase that writes a passwordHash. All three paths
// — self-service change, admin reset, token redeem — go through here.
//
// The burn shares the write's transaction for a reason that is not tidiness.
// An attacker requests a reset and reads the link out of a mailbox they have
// compromised. The real owner notices something is wrong and changes their
// password from inside the app. If the outstanding token survives that, the
// attacker simply clicks the link and undoes the fix — so a password write
// that does not kill outstanding tokens leaves the current-password check on
// /api/auth/password meaning nothing.
//
// bcrypt runs BEFORE the transaction opens. It costs ~250ms of CPU at cost 12,
// and holding a row lock for that long on a single-process app is a
// self-inflicted stall.
export async function setUserPassword({ userId, newPassword, bumpTokenVersion = false }) {
  const passwordHash = await hashPassword(newPassword);
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        ...(bumpTokenVersion ? { tokenVersion: { increment: 1 } } : {}),
      },
      include: { account: true },
    });
    await burnOutstanding(tx, userId);
    return updated;
  });
  // Outside the transaction: the cache is process-local memory, and evicting
  // it inside a transaction that might still roll back would be the wrong
  // order. A second pm2 instance picks the bump up within its own TTL.
  if (bumpTokenVersion) invalidateSessionCache(userId);
  return user;
}

// Returns { token, row }, or null when a throttle suppressed the send.
//
// The whole thing runs inside ONE transaction that begins by taking a per-user
// advisory lock, and that is load-bearing rather than belt-and-braces.
//
// Reading the cap and the cooldown outside the write was a check-then-act
// race: N simultaneous requests for one address all observe the pre-insert
// state, all pass both throttles, and all insert. burnOutstanding cannot
// serialise them, because under READ COMMITTED it is an UPDATE matching zero
// committed rows while the competing INSERT is still uncommitted — it takes no
// lock and blocks nothing. The observed result was four live tokens and four
// emails for one address inside a window that permits one, which defeats both
// the "exactly one live link" invariant and the mailbox-flood protection the
// constants above exist for. Simply moving the reads inside the transaction is
// NOT enough for the same reason; the lock is what makes the second caller
// wait until the first has committed.
//
// pg_advisory_xact_lock releases on commit or rollback, so there is nothing to
// leak. It is keyed on the user, so resets for different people never contend.
export async function issueToken(userId) {
  const now = new Date();

  const issued = await prisma.$transaction(async (tx) => {
    // FIRST statement, before either read.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

    // Both throttle reads now see every committed sibling, because any
    // concurrent issuer for this user is either finished or still blocked.
    const recent = await tx.passwordResetToken.count({
      where: { userId, createdAt: { gt: new Date(now.getTime() - 3_600_000) } },
    });
    if (recent >= SENDS_PER_HOUR) return null;

    const last = await tx.passwordResetToken.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (last && now.getTime() - last.createdAt.getTime() < SEND_COOLDOWN_MS) return null;

    // Returning null above leaves the transaction having done nothing but take
    // a lock — which is exactly right. A capped request that burned the user's
    // live token before declining to send would lock them out of the account
    // the reset exists to recover.
    const { token, tokenHash } = mintToken();

    // Exactly one live link per user, always. Two live tokens is two live
    // takeover credentials for one account, and the only thing a second one
    // buys is dodging a bounded annoyance. A partial unique index on
    // (userId) WHERE usedAt IS NULL enforces this in the database too, so the
    // invariant survives a future caller that forgets the burn.
    await burnOutstanding(tx, userId);
    const row = await tx.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt: new Date(now.getTime() + TTL_MS) },
    });
    return { token, row };
  });

  if (!issued) return null;

  // Opportunistic sweep rather than a scheduled job. The table only grows on
  // this path, so cleanup runs on exactly the event that causes growth and
  // cannot fall behind it. Note that a request for an address with no User row
  // creates nothing at all — the foreign key is itself the anti-flood control.
  //
  // Outside the transaction and detached: a failed tidy-up must never fail a
  // reset, and it must not hold the per-user lock while it scans.
  prisma.passwordResetToken
    .deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - SWEEP_GRACE_MS) } } })
    .catch(() => {});

  return issued;
}

// PUBLIC_BASE_URL, parsed and sanity-checked.
//
// A reset link with a broken base is a person locked out with no recovery
// path — backend/routes/integrations/public.js already carries a redirect that
// exists solely to rescue unsubscribe links sent while this var had a bad
// prefix baked in, and those live in inboxes forever.
function validBaseUrl() {
  const raw = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // A base carrying a query or fragment would swallow the path we append.
  //
  // Testing parsed.search/parsed.hash alone is not enough: both are the EMPTY
  // STRING for the degenerate forms 'https://host?' and 'https://host#', so
  // those passed the guard — and since the raw string was what got returned,
  // the '#' case put the whole reset token in the URL fragment, where the
  // server never receives it and the link is simply dead.
  if (parsed.search || parsed.hash || raw.includes('?') || raw.includes('#')) return null;
  // localhost, 127/8, 10/8, 192.168/16, 172.16/12, ::1, *.local — a link
  // nobody outside the box can open. Only in production: in dev that IS the
  // address.
  if (process.env.NODE_ENV === 'production' && isUnreachableUrl(raw)) return null;
  // Return what was VALIDATED, not what was typed. Rebuilding from the parsed
  // URL also normalises the scheme and host casing and collapses a doubled
  // trailing slash, so the string we concatenate is the string we checked.
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

// Whether this install can actually offer a reset, and if not, why.
//
// Env is checked FIRST so the default install — flag off — pays zero database
// work for a feature it has not enabled. /api/auth/status is unauthenticated
// and sits on the path of every anonymous page load.
//
// "The flag is on" is deliberately not sufficient. A "Forgot password" link
// that appears and then cannot send is a worse failure than a hidden one: the
// user has no way to tell a lost email from a broken server, and the response
// is identical by design.
export async function resolvePasswordResetCapability() {
  if (process.env.ALLOW_PASSWORD_RESET !== 'true') {
    return { enabled: false, reason: 'ALLOW_PASSWORD_RESET is not "true"' };
  }
  if (isDemoMode()) {
    return { enabled: false, reason: 'DEMO_MODE is on, so no mail would leave the box' };
  }
  if (!getProvider().isConfigured()) {
    return { enabled: false, reason: 'the email provider has no API key' };
  }
  const baseUrl = validBaseUrl();
  if (!baseUrl) {
    return {
      enabled: false,
      reason: 'PUBLIC_BASE_URL is unset, or not a usable absolute http(s) URL',
    };
  }
  const sender = await resolveSender();
  if (!sender) {
    return {
      enabled: false,
      reason: 'no sender is configured (Settings → Connections, or BREVO_SENDER_EMAIL + BREVO_SENDER_NAME)',
    };
  }
  return { enabled: true, reason: null, sender, baseUrl };
}

// base64url is exactly [A-Za-z0-9_-], so there is nothing to percent-encode
// and none is applied.
//
// The token appears once in the web server's access log, for the GET of the
// reset page. That is bounded by the 60-minute TTL and single use rather than
// eliminated, and naming it is what makes those two properties load-bearing
// rather than decorative. On the shared-VM layout in docs/SECOND-INSTANCE.md,
// whoever can read those logs can read the other business's live tokens for
// that window.
export function buildResetUrl(baseUrl, token) {
  return `${baseUrl}/reset-password/${token}`;
}

// The message. Deliberately plain: no images, no tracking pixel, no web font,
// no remote URL but the link itself, no preheader, no unsubscribe footer.
//
// It must not contain: any password; the token anywhere except inside the
// link; a separate copyable code; or the requester's IP or user agent — both
// of those arrive in attacker-controlled headers, and the audit row already
// holds them.
export function buildResetEmail({ workspaceLabel, url }) {
  // Capped: a subject line is a lock-screen surface the account owner does not
  // control, and Account.name is operator-supplied free text.
  const label = String(workspaceLabel || '').slice(0, 60);
  const subject = `Reset your password for ${label}`;

  // Every interpolated value is escaped. An unescaped anchor smuggled into a
  // workspace name would turn that workspace's own reset email into a phishing
  // carrier aimed at someone with every reason to trust it.
  const safeLabel = escapeHtml(label);
  const safeUrl = escapeHtml(url);

  const htmlContent = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600">Reset your password</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">
        Someone asked to reset the password for your ${safeLabel} account.
        Use the button below to choose a new one.
      </p>
      <p style="margin:0 0 24px">
        <a href="${safeUrl}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:500">Choose a new password</a>
      </p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#52525b">
        This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes and can only be
        used once. Requesting another reset replaces it.
      </p>
      <p style="margin:0;font-size:14px;line-height:1.5;color:#52525b">
        If you did not ask for this, you can ignore this email — your password
        will not change.
      </p>
    </div>
  </body>
</html>`;

  // NOT escaped. This part is rendered as literal text, so escaping it would
  // show the reader "&amp;". It is what screen readers and terminal clients
  // get, and a stub text part hurts deliverability on the one send that
  // absolutely must reach an inbox.
  const textContent = `Reset your password

Someone asked to reset the password for your ${label} account.
Open this link to choose a new one:

${url}

This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes and can only be used
once. Requesting another reset replaces it.

If you did not ask for this, you can ignore this email — your password will
not change.`;

  return { subject, htmlContent, textContent };
}

// Two workspaces on one install send from the SAME address: resolveSender()
// reads the global Setting row and env, not Account.senderEmail, so the
// workspace name is the only thing telling the two apart in an inbox.
//
// 'Default workspace' is the name the multi-tenant migration seeded, which
// says nothing to a reader, so it falls back to the sender's name. We do not
// read Account.senderEmail — it is unwired, and using it here would create a
// second, divergent sender path.
export function workspaceLabelFor(user, sender) {
  const name = user?.account?.name;
  if (!name || name === 'Default workspace') return sender.name;
  return name;
}

// One line at boot saying whether reset is live, and if not, exactly why.
//
// Logs and continues — never process.exit. assertEveryRouteIsGated exits
// because the alternative there is silent EXPOSURE; an unsendable reset link
// is a missing convenience, and killing the install (and its campaign sending)
// over it is the larger outage. Lives here rather than in setupStatus.js
// because this module already imports that one, and the reverse would be a
// cycle.
export async function logPasswordResetStatus() {
  try {
    const capability = await resolvePasswordResetCapability();
    if (capability.enabled) {
      console.log(`[setup] Password reset: ENABLED (links valid ${RESET_TOKEN_TTL_MINUTES} min, from "${capability.sender.name} <${capability.sender.email}>").`);
      return;
    }
    // The flag being off is the default and not worth alarming about. The flag
    // being ON while something else blocks it is a misconfiguration the
    // operator intended to avoid, so it is louder.
    if (process.env.ALLOW_PASSWORD_RESET !== 'true') {
      console.log(`[setup] Password reset: disabled (${capability.reason}).`);
      return;
    }
    console.warn(`[setup] Password reset: DISABLED — ALLOW_PASSWORD_RESET=true but ${capability.reason}.`);
  } catch (error) {
    console.log('[setup] Password reset status check failed:', error.message);
  }
}
