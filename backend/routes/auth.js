import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/db.js';
import {
  hashPassword,
  publicUser,
  requireAuth,
  signToken,
  userCount,
  verifyPassword,
} from '../lib/auth.js';
import { resolvePermissions, seedAccountRoles } from '../lib/permissions.js';
import { recordAudit } from '../lib/audit.js';
import { sendTestEmail } from '../lib/brevoClient.js';
import {
  TOKEN_SHAPE,
  buildResetEmail,
  buildResetUrl,
  hashToken,
  issueToken,
  resolvePasswordResetCapability,
  setUserPassword,
  workspaceLabelFor,
} from '../lib/passwordReset.js';
import { validate, z } from '../lib/validate.js';
import { asyncRoute } from '../utils/store.js';

// Bundle a user with their resolved area permissions for the client.
//
// This is the levelled map ({ v: 2, areas: { campaigns: 'manage' } }) plus a
// precomputed __effective including implied reads, so the client answers
// can('campaigns', 'manage') without recomputing implications on every
// render. The frontend uses it to decide which nav items, pages, settings
// sections and buttons to show.
//
// It decides what is DRAWN and nothing else. Backend enforcement is
// independent (permissionGate) and does not trust this object — it resolves
// the role again from the caller's JWT on every request.
async function userWithPermissions(user) {
  const permissions = await resolvePermissions(user.accountId, user.role);
  return { ...publicUser(user), permissions };
}

const credentialsSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1),
});

// Email ONLY. The old shape was { email, newPassword } and it set that
// password, which was the takeover.
//
// .strict() so an extra key is a validation failure rather than silently
// ignored input. Zod strips unknown keys by default, which would mean the OLD
// frontend's { email, newPassword } parsed to { email }, returned ok:true and
// mailed a link — while the user's screen said "the password has been reset."
// That window is real: a tab left open across a deploy, and the seconds
// between `npm run build` writing dist/ and pm2 restarting, during which the
// old process serves the new bundle.
const forgotSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
}).strict('This server now emails a reset link. Reload the page and try again.');

// The user whose password changes is read from PasswordResetToken.userId and
// nowhere else. No email, no userId, no accountId — the replaced route took
// { email, newPassword } and trusted the email, and that WAS the takeover.
//
// Length bound only; the exact 43-character shape is checked in the HANDLER,
// because validate() renders `${path}: ${issue.message}` (lib/validate.js), so
// a schema-level regex would produce a visibly different body from the generic
// failure and re-open the oracle the generic failure exists to close.
//
// A .strict() rejection IS allowed to look different from a dead link: the
// uniform-response rule is about TOKEN STATE, and a body carrying an unknown
// key leaks nothing about the token or the account. Do not "fix" this into the
// generic path.
const redeemSchema = z.object({
  token: z.string().max(500),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
}).strict();

const checkSchema = z.object({ token: z.string().max(500) }).strict();

// Compared against when no user is found, so a nonexistent address costs the
// same ~250ms of bcrypt as a real one.
//
// Without it the login form is a faster and cleaner membership oracle than the
// reset endpoint ever was: `!user || !(await verifyPassword(...))` short-
// circuits, so a miss returns in ~3ms and a hit spends a quarter of a second
// in bcrypt. Hardening the reset flow while leaving that in place would buy
// nothing. The body and status were already identical; only the clock leaked.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('unused-placeholder-for-timing-parity', 12);

// Unknown, malformed, expired, already-used, superseded, and
// user-deleted-since all produce this one status and body.
//
// Distinguishable errors confirm that a guessed token was once real, confirm
// an account exists, and "expired" on its own mis-teaches the user into
// clicking the same dead link in the same email again.
const RESET_LINK_DEAD = 'This reset link is no longer valid. Request a new one.';
function genericResetFailure(res) {
  res.status(400).json({ error: RESET_LINK_DEAD });
}

const RESET_DISABLED = 'Password reset is disabled on this server. Ask an admin to set a new password for you.';

// Name and location only. Trimmed, length-capped, and empty means "clear
// it" rather than "leave it" — a person removing their location should be
// able to, and a nullable column is how that is spelled.
const profileSchema = z.object({
  name: z.string().trim().max(80).optional(),
  location: z.string().trim().max(80).optional(),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  // Opt-in. Changing a password and ending every other session are related
  // but separate acts: someone tidying up their password monthly should not
  // have to sign back in on their phone, and someone who thinks they have
  // been compromised needs to be able to.
  signOutOthers: z.boolean().optional(),
  // Same floor as signup. A self-service change that accepted weaker
  // passwords than the signup form would be a hole dressed as convenience.
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again later.' },
});

// Tighter than authLimiter and keyed the same way. A password-change form
// that will verify the current password is a password ORACLE: whoever holds
// a session can sit and guess the real owner's password against it. Twenty
// tries per quarter-hour is plenty for someone who mistyped and useless for
// someone who is guessing.
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password attempts. Try again later.' },
});

// Same numbers, SEPARATE store, and that is the entire point.
//
// Redeeming a reset link needs the tighter bound for the same reason the
// authenticated change does — it writes a password and it is a guessing
// oracle. But it is open to the world, while /api/auth/password deliberately
// mounts requireAuth AHEAD of its limiter so that anonymous traffic cannot
// consume the quota a real user needs. Sharing one rateLimit instance would
// hand that budget straight back to anonymous callers and undo it: a stranger
// spraying guesses at /api/auth/reset-password would lock a signed-in person
// out of changing their own password from behind the same NAT.
const resetRedeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password attempts. Try again later.' },
});

export function registerAuthRoutes(app) {
  app.post(
    '/api/auth/signup',
    authLimiter,
    validate(credentialsSchema),
    asyncRoute(async (req, res) => {
      const existingCount = await userCount();
      const allowOpenSignup = process.env.ALLOW_OPEN_SIGNUP === 'true';

      if (existingCount > 0 && !allowOpenSignup) {
        res.status(403).json({ error: 'Signup is closed. Ask an admin to invite you.' });
        return;
      }

      const existing = await prisma.user.findUnique({ where: { email: req.body.email } });
      if (existing) {
        res.status(409).json({ error: 'An account with that email already exists' });
        return;
      }

      const passwordHash = await hashPassword(req.body.password);
      // Each signup gets its OWN Account (workspace). The very first
      // user on a fresh install still lands in the 'default' account
      // that the multi-tenant migration seeded, so their existing data
      // (created pre-multi-tenancy) stays attached to their session.
      // Every subsequent signup creates a brand-new Account so their
      // data is isolated from everyone else's.
      const accountId = existingCount === 0
        ? 'default'
        : (await prisma.account.create({
            data: {
              name: req.body.name
                ? `${req.body.name}'s workspace`
                : `${req.body.email.split('@')[0]}'s workspace`,
            },
          })).id;

      const user = await prisma.user.create({
        data: {
          email: req.body.email,
          passwordHash,
          name: req.body.name || null,
          // First user on the install is the super-admin (admin of the
          // default workspace). Subsequent signups are admins of their
          // OWN workspace — they're the owner of the Account they just
          // created, even though they're not super-admin of the install.
          role: 'admin',
          isSuperAdmin: existingCount === 0,
          accountId,
        },
        include: { account: true },
      });

      // Make sure this account has its built-in roles before we resolve the
      // new user's permissions. The 'default' account is seeded at startup;
      // a freshly-created account is seeded here. Idempotent either way.
      await seedAccountRoles(user.accountId);

      res.status(201).json({
        token: signToken(user),
        user: await userWithPermissions(user),
      });
    }),
  );

  app.post(
    '/api/auth/login',
    authLimiter,
    validate(loginSchema),
    asyncRoute(async (req, res) => {
      const user = await prisma.user.findUnique({
        where: { email: req.body.email },
        include: { account: true },
      });

      // Always run bcrypt, even with no user, so the two cases take the same
      // time. See DUMMY_PASSWORD_HASH.
      const passwordOk = await verifyPassword(
        req.body.password,
        user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      );
      if (!user || !passwordOk) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      res.json({ token: signToken(user), user: await userWithPermissions(user) });
    }),
  );

  // --- self-service profile ------------------------------------------------
  //
  // These are the only routes in the app where a user changes their OWN
  // record, so the shape of them matters more than their size.
  //
  // What they deliberately cannot touch: email, role, isSuperAdmin,
  // accountId. Every one of those is an escalation if self-served — role and
  // isSuperAdmin obviously, email because it is the login identity and the
  // password-reset target, accountId because it is the tenant boundary. The
  // update below names its fields explicitly rather than spreading req.body,
  // so adding a column to the User model cannot quietly make it writable.
  app.patch(
    '/api/auth/profile',
    requireAuth,
    validate(profileSchema),
    asyncRoute(async (req, res) => {
      // A JWT lives 7 days and there is no token store, so a user deleted by
      // an admin keeps a working token until it expires. Without this check
      // the update throws a raw Prisma error and the client gets a 500, where
      // /auth/me and /auth/password both answer 401 for the same situation.
      const existing = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!existing) {
        res.status(401).json({ error: 'Account no longer exists' });
        return;
      }
      const data = {};
      if (req.body.name !== undefined) data.name = req.body.name;
      if (req.body.location !== undefined) data.location = req.body.location;
      const updated = await prisma.user.update({
        where: { id: req.user.id },
        data,
        include: { account: true },
      });
      await recordAudit(req, 'user.profile.update', 'user', req.user.id, {
        fields: Object.keys(data),
      });
      res.json({ user: await userWithPermissions(updated) });
    }),
  );

  // Changing your own password REQUIRES the current one.
  //
  // Not a formality. A session token that leaks — a shared machine, a stolen
  // laptop, an XSS — otherwise lets whoever holds it set a new password and
  // lock the real owner out of their own workspace, turning a temporary
  // compromise into a permanent one. Asking for the current password means
  // the attacker needs the thing they were trying to obtain.
  //
  // The failure is also deliberately slow-ish and generic: bcrypt.compare
  // costs real time, and the message never distinguishes "wrong password"
  // from anything else.
  app.post(
    '/api/auth/password',
    // requireAuth FIRST. The limiter keys on req.ip, so mounted ahead of the
    // auth check an unauthenticated stranger behind the same NAT — or any
    // stranger at all — could burn the quota with tokenless requests and lock
    // a real user out of changing their own password. Rejecting the anonymous
    // request before it counts costs nothing and removes the denial-of-service.
    requireAuth,
    passwordChangeLimiter,
    validate(passwordChangeSchema),
    asyncRoute(async (req, res) => {
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user) {
        res.status(401).json({ error: 'Account no longer exists' });
        return;
      }
      if (!(await verifyPassword(req.body.currentPassword, user.passwordHash))) {
        // Audited as a failure, because a run of these on one account is
        // exactly the signal an admin would want to see afterwards.
        await recordAudit(req, 'user.password.failed', 'user', user.id, {});
        res.status(400).json({ error: 'Your current password is not correct.' });
        return;
      }
      if (req.body.newPassword === req.body.currentPassword) {
        res.status(400).json({ error: 'Choose a password you have not used here before.' });
        return;
      }
      // setUserPassword is the single password writer. It stamps
      // passwordChangedAt, bumps tokenVersion when asked, and — the part that
      // matters here — burns any outstanding reset tokens in the same
      // transaction. Without that, someone who changed their password because
      // they suspected a compromise could be undone by a reset link already
      // sitting in the attacker's copy of their mailbox, which would make this
      // route's current-password check meaningless.
      //
      // The bump-first-then-mint ordering the comment below describes is
      // preserved: the writer bumps inside its transaction and returns the new
      // version, so the replacement token is minted from it afterwards.
      // Minting first would revoke the token we are about to hand back, and
      // sign the caller out of the device they are sitting at.
      const updated = await setUserPassword({
        userId: user.id,
        newPassword: req.body.newPassword,
        bumpTokenVersion: Boolean(req.body.signOutOthers),
      });
      const tokenVersion = req.body.signOutOthers ? updated.tokenVersion : undefined;

      await recordAudit(req, 'user.password.change', 'user', user.id, {
        signedOutOtherSessions: Boolean(req.body.signOutOthers),
        resetTokensInvalidated: true,
      });

      // A fresh token either way, so the caller is not left holding one
      // minted before the change. The user comes back too, so the profile
      // page can show the new "last changed" without a reload.
      res.json({
        token: signToken(user, tokenVersion),
        ok: true,
        signedOutOthers: Boolean(req.body.signOutOthers),
        user: await userWithPermissions(updated),
      });
    }),
  );

  app.get('/api/auth/me', requireAuth, asyncRoute(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { account: true },
    });
    if (!user) {
      res.status(401).json({ error: 'Account no longer exists' });
      return;
    }
    res.json({ user: await userWithPermissions(user) });
  }));

  // A bare boolean and nothing more. No reason code, no senderConfigured, no
  // providerConfigured: a reason string on an unauthenticated endpoint tells
  // anyone who asks what this install's mail posture is. The operator
  // diagnosing "I set the flag and nothing happened" is authenticated, and has
  // both the boot log and Settings → Connections.
  //
  // This must never call the email provider. getSetupStatus() / checkAccount()
  // / fetchVerifiedSenders() all reach api.brevo.com, and this endpoint is hit
  // on every anonymous page load — wiring them in would let a stranger drive
  // OUR provider rate limit, taking real campaign sends down with it, and add
  // a network round trip to first paint. Env, plus at most one Setting row.
  app.get('/api/auth/status', asyncRoute(async (_req, res) => {
    res.json({
      hasUsers: (await userCount()) > 0,
      openSignup: process.env.ALLOW_OPEN_SIGNUP === 'true',
      passwordResetEnabled: (await resolvePasswordResetCapability()).enabled,
    });
  }));

  // --- password reset ------------------------------------------------------
  //
  // UNAUTHENTICATED BY CONSTRUCTION, and that is the whole risk surface.
  //
  // '/auth' is on the OPEN list in lib/permissions.js and isOpen() prefix-
  // matches, so permissionGate calls next() before it looks at anything else —
  // and assertEveryRouteIsGated treats these as covered, which means the boot
  // assertion that catches every other ungated route will NOT catch a mistake
  // here. Registration order also puts them ahead of app.use('/api',
  // requireAuth). The protection lives in these handlers and nowhere else.
  //
  // Nothing about this feature requires widening an allowlist. Any diff to
  // OPEN in service of password reset is a mistake by definition.

  // recordAudit reads userId / userEmail / accountId off req.user, which does
  // not exist on an unauthenticated route. Left alone the row lands with
  // accountId NULL — and listAuditLogs filters by accountId, so the workspace
  // admin's Access → audit view would never show that a reset was requested or
  // redeemed for one of their own users.
  //
  // Object.create, NOT { ...req }: req.ip is a getter on Express's request
  // PROTOTYPE, and a spread copies own enumerable properties only. Spreading
  // would silently blank the audit IP on any install not behind a proxy — the
  // one field the column exists to answer.
  //
  // userId and userEmail stay null on purpose. The actor genuinely is unknown:
  // whoever held the link. The affected workspace is not, and the subject is
  // carried by resourceId.
  function auditActor(req, user) {
    const actor = Object.create(req);
    actor.user = { accountId: user.accountId };
    return actor;
  }

  // Everything past the response: mint, mail, audit. Never throws past its
  // caller's .catch(), and never interpolates the token into any string but
  // the email body and the development console line.
  async function deliverReset(req, user, capability) {
    const issued = await issueToken(user.id);
    // Suppressed by the per-address cap or cooldown. Silent by necessity: an
    // address with no User row can NEVER trip a per-user cap, so a 429 here —
    // or any distinguishable response — would rebuild the enumeration oracle
    // this whole endpoint exists to close. The check lives past the response
    // so the code that writes the response cannot branch on it.
    if (!issued) return;

    const url = buildResetUrl(capability.baseUrl, issued.token);
    const { subject, htmlContent, textContent } = buildResetEmail({
      workspaceLabel: workspaceLabelFor(user, capability.sender),
      url,
    });

    let result;
    try {
      // The existing single-recipient shape. sendTransactionalEmail wants a
      // `contact` and stamps campaign tags this send has none of.
      //
      // Known wart, accepted for v1: BrevoProvider.sendTestEmail hardcodes
      // tags ['posty','campaign-suite-test'], so a reset shows in Brevo's log
      // labelled a test send. An optional `tags` parameter on the
      // EmailProvider contract is the follow-up; churning the provider
      // contract for a label is not worth blocking a security fix.
      //
      // Deliberately NOT consulting the Unsubscribe table: a reset is
      // transactional and consent-irrelevant. Honouring a marketing opt-out
      // here would permanently lock out an admin who once clicked unsubscribe
      // in a test campaign, with no error anywhere explaining why.
      //
      // toEmail comes from the User ROW, never req.body.email. The same
      // transform lowercases both so they are equal — using the row is what
      // makes it unmistakable that we never mail an address with no account.
      result = await sendTestEmail({
        toEmail: user.email,
        subject,
        htmlContent,
        textContent,
        sender: capability.sender,
      });
    } catch (error) {
      console.error('[auth] reset send failed', {
        userId: user.id,
        providerStatus: error.providerStatus ?? null,
        message: error.message,
      });
      await recordAudit(auditActor(req, user), 'user.password.reset_requested', 'user', user.id, {
        tokenId: issued.row.id,
        delivery: 'failed',
        providerStatus: error.providerStatus ?? null,
      });
      return;
    }

    // Branch on result.dryRun, NOT on isConfigured(). brevoFetch RESOLVES with
    // { dryRun: true, accepted: true } rather than throwing, so an uninspected
    // await is indistinguishable from a delivery — and `accepted: true` makes
    // it look like a positive signal.
    const dryRun = result?.dryRun === true;
    // The capability gate already refuses to enable the feature under
    // DEMO_MODE or with no API key, so a dry run here can only mean the key
    // went away mid-flight. In development that is the single-user
    // self-hosted lockout path the old takeover endpoint existed to serve, and
    // printing the link to the operator's own terminal is a legitimate
    // recovery route that costs nothing. In production it is a live bearer
    // credential written to a log — which on the shared-VM layout includes the
    // other business.
    if (dryRun && process.env.NODE_ENV !== 'production') {
      console.log(`[auth] DRY-RUN: reset link for ${user.email} -> ${url}`);
    } else if (dryRun) {
      console.warn(`[auth] Password reset email for ${user.email} was NOT sent: the provider is in dry-run. No link is logged in production.`);
    }

    // Metadata never carries `token` or `tokenHash`. AuditLog.metadata is
    // readable by any workspace admin through listAuditLogs, and across
    // workspaces by a super-admin — a token sitting there is colleague-to-
    // colleague account takeover through the audit UI. For the same reason,
    // never copy `{ changes: req.body }` from admin.js onto the redeem route:
    // that body holds the new plaintext password, and audit rows are permanent.
    await recordAudit(auditActor(req, user), 'user.password.reset_requested', 'user', user.id, {
      tokenId: issued.row.id,
      expiresAt: issued.row.expiresAt,
      delivery: dryRun ? 'dry-run' : 'sent',
    });

    // A hard bounce on this email produces NO signal inside Posty:
    // resolveEventAccountId returns null for a payload with no `campaign:` tag
    // and the webhook 202-accepts and drops it. The tempting fix — giving
    // reset sends a campaign tag — is fatal: hard_bounce is in BOUNCE_EVENTS,
    // and with bounce-sync on, upsertUnsubscribe would add the workspace
    // admin's own login address to the suppression list, excluding them from
    // every future campaign as a side effect of one failed reset.
  }

  // Route 1: ask for a link.
  app.post(
    '/api/auth/forgot-password',
    authLimiter,
    validate(forgotSchema),
    asyncRoute(async (req, res) => {
      const capability = await resolvePasswordResetCapability();
      if (!capability.enabled) {
        res.status(403).json({ error: RESET_DISABLED });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { email: req.body.email },
        include: { account: true },
      });

      // Respond BEFORE any work, and identically either way.
      //
      // Byte-identical bodies are not enough on their own. Awaiting the token
      // insert plus a live HTTPS round trip to the provider would put hundreds
      // of milliseconds into the known-address path only, which is trivially
      // measurable and enumerates every account on the install. Detaching also
      // stops a provider outage from looking like an app outage.
      //
      // Residual, stated rather than hidden: both branches now do exactly one
      // indexed findUnique before answering, so the remaining delta is an
      // index hit versus a miss. We are deliberately NOT buying an artificial
      // response floor to close that — it is below the noise floor of the
      // public internet, and this endpoint's own sibling /api/auth/status
      // already runs an uncached COUNT(*).
      res.json({ ok: true });
      if (!user) return;

      // The .catch is NOT optional. An unhandled rejection tears the process
      // down on modern Node, any stranger could trigger it at will, and
      // server.js's error handler never sees a rejection that escaped the
      // request.
      deliverReset(req, user, capability).catch((error) => {
        console.error('[auth] reset delivery failed', {
          userId: user.id,
          message: error.message,
        });
      });
    }),
  );

  // Route 2: redeem it. passwordChangeLimiter because this writes a password
  // AND is a token-guessing oracle.
  app.post(
    '/api/auth/reset-password',
    resetRedeemLimiter,
    validate(redeemSchema),
    asyncRoute(async (req, res) => {
      const capability = await resolvePasswordResetCapability();
      if (!capability.enabled) {
        res.status(403).json({ error: RESET_DISABLED });
        return;
      }
      // Shape-checked here rather than in the schema. See redeemSchema.
      if (!TOKEN_SHAPE.test(req.body.token)) {
        genericResetFailure(res);
        return;
      }

      const row = await prisma.passwordResetToken.findUnique({
        where: { tokenHash: hashToken(req.body.token) },
      });
      if (!row) {
        genericResetFailure(res);
        return;
      }

      // ONE conditional UPDATE carrying every guard, with the affected count
      // checked.
      //
      // Never findUnique-then-update: two simultaneous POSTs would both read
      // usedAt: null, both proceed, both set a DIFFERENT password, both be
      // told "success", and whoever commits last owns the account. That is the
      // attack the moment a link reaches a link-scanner or a shared inbox.
      // Postgres decides it instead: under READ COMMITTED the second writer
      // blocks on the row lock, re-evaluates its own WHERE against the
      // committed row version, and updates zero rows.
      //
      // updateMany rather than update() with extra filters: whether Prisma
      // compiles that to a self-subquery — and therefore whether the guard is
      // re-evaluated under EvalPlanQual — is a codegen detail, and this
      // invariant must not rest on one.
      //
      // The claim happens BEFORE the new password is hashed. Hashing first
      // would widen the race by ~250ms and spend 250ms of blocking CPU per
      // invalid guess on a public route, which is free denial-of-service
      // amplification on a single-process app. The resulting timing difference
      // leaks only token validity, and only to someone already holding the
      // token — a deliberate, reasoned exception to constant-time, written
      // down so it is not "fixed" later.
      const now = new Date();
      const claim = await prisma.passwordResetToken.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claim.count !== 1) {
        const owner = await prisma.user.findUnique({
          where: { id: row.userId },
          select: { id: true, accountId: true },
        });
        if (owner) {
          // Re-read before labelling. `row` is the snapshot from BEFORE the
          // claim, so deriving the reason from it mislabels every token that
          // was still live when we read it and lost the race — which is
          // precisely the two-simultaneous-redemptions case this handler is
          // built around. Those were being recorded as "expired", which is the
          // one thing an admin reading the audit log would use to rule out
          // foul play. The distinction never reaches the caller; the response
          // stays identical either way.
          const fresh = await prisma.passwordResetToken.findUnique({
            where: { id: row.id },
            select: { usedAt: true, expiresAt: true },
          });
          let reason = 'expired';
          if (!fresh) reason = 'vanished';
          else if (row.usedAt) reason = 'already_used';
          else if (fresh.usedAt && fresh.expiresAt > now) reason = 'claimed_concurrently';
          else if (fresh.usedAt) reason = 'already_used';
          await recordAudit(auditActor(req, owner), 'user.password.reset_failed', 'user', owner.id, {
            tokenId: row.id,
            reason,
          });
        }
        genericResetFailure(res);
        return;
      }

      // The cascade makes the row vanish with the user, but a redeem racing
      // that delete can find a token and lose the user before the write. A raw
      // Prisma P2025 would surface as a 500 where every other failure here
      // answers 400 — which both leaks that the token was real and breaks the
      // uniform response.
      const user = await prisma.user.findUnique({
        where: { id: row.userId },
        select: { id: true, email: true, accountId: true },
      });
      if (!user) {
        genericResetFailure(res);
        return;
      }

      // No verifyPassword anywhere on this path. A "don't reuse your old
      // password" check would turn the link into an "is X this account's
      // current password?" oracle for whoever holds it, and buys nothing: the
      // tokenVersion bump evicts an attacker regardless of what the new
      // password is.
      //
      // bumpTokenVersion: true invalidates EVERY token for this user
      // everywhere, including any the redeemer holds. revokeOtherSessions() is
      // named for its first caller, where "other" only holds because that
      // route mints a replacement; here we mint nothing, so "other sessions"
      // is "all sessions" and there is no opt-out — someone resetting because
      // they were compromised needs the attacker signed out.
      //
      // Honest limit: currentTokenVersion caches per process for 60 seconds,
      // so a second pm2 instance keeps honouring an old token for up to a
      // minute. This is not instant and must never be described as such.
      await setUserPassword({
        userId: user.id,
        newPassword: req.body.newPassword,
        bumpTokenVersion: true,
      });
      await recordAudit(auditActor(req, user), 'user.password.reset_completed', 'user', user.id, {
        tokenId: row.id,
        signedOutAllSessions: true,
      });

      // No token, no user object.
      //
      // Redeeming a link that arrived by email is not proof of identity the
      // way typing the new password at /login is. Auto-login would make the
      // URL itself a session credential, so anything that reads URLs — a
      // forwarded mail, a shared inbox, a link prefetcher, browser history on
      // a shared machine — upgrades from "can set a password the owner will
      // notice" to "is signed in". Keeping /login the only session-minting
      // path also means whatever login grows later (MFA, SSO) cannot be walked
      // around through the recovery door.
      res.json({ ok: true });
    }),
  );

  // Route 3: is this link still alive?
  //
  // Non-consuming — a validity probe that burned the token would mean the
  // user's own page load destroyed their reset. Returns a bare boolean and
  // nothing else: the tempting "signing in as sanmi@…" touch would turn a
  // leaked URL into an address disclosure, and hand an attacker holding a
  // guessed token a clean confirmation channel. Rate-limited, because without
  // it this is a free token-guessing oracle with no side effects to notice.
  app.post(
    '/api/auth/reset-password/check',
    authLimiter,
    validate(checkSchema),
    asyncRoute(async (req, res) => {
      const capability = await resolvePasswordResetCapability();
      if (!capability.enabled) {
        res.status(403).json({ error: RESET_DISABLED });
        return;
      }
      if (!TOKEN_SHAPE.test(req.body.token)) {
        res.json({ valid: false });
        return;
      }
      const row = await prisma.passwordResetToken.findUnique({
        where: { tokenHash: hashToken(req.body.token) },
      });
      res.json({ valid: Boolean(row && !row.usedAt && row.expiresAt > new Date()) });
    }),
  );
}
