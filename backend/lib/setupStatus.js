// "Can this install actually send?" — one place that answers it, instead of
// leaving the admin to guess. Powers two things:
//   1. logProviderStatus() — a boot-time log so a bad/rejected API key (or an
//      unverified sender) is obvious the moment the server starts, not only
//      when a send mysteriously fails.
//   2. getSetupStatus() — the GET /api/settings/status payload behind the
//      "Setup status" card in Settings → Connections.
//
// The key distinction the old "is BREVO_API_KEY set?" check missed: a key can
// be SET but INVALID ("Key not found"). Here we actually call Brevo /account
// to confirm the key WORKS.
import { checkAccount, fetchVerifiedSenders } from './brevoClient.js';
import { resolveSender } from './sender.js';
import { prisma } from './db.js';

function hasKey() {
  return Boolean(process.env.BREVO_API_KEY);
}

function isDemoMode() {
  return process.env.DEMO_MODE === '1' || process.env.DEMO_MODE === 'true';
}

export async function getSetupStatus() {
  const configured = hasKey();
  const demoMode = isDemoMode();
  const provider = {
    configured,
    // dryRun = emails are logged, not delivered (no key, or DEMO_MODE on).
    dryRun: !configured || demoMode,
    valid: false,
    account: null,
    plan: null,
    error: null,
  };

  if (configured && !demoMode) {
    try {
      const acct = await checkAccount();
      provider.valid = true;
      provider.account = acct?.email || null;
      provider.plan = acct?.plan?.[0]?.type || null;
    } catch (error) {
      provider.valid = false;
      provider.error = error.message;
    }
  }

  const resolved = await resolveSender().catch(() => null);
  const sender = {
    configured: Boolean(resolved?.email),
    email: resolved?.email || null,
    name: resolved?.name || null,
    // null = couldn't determine (no valid key, or the lookup failed).
    verified: null,
  };

  if (provider.valid && sender.configured) {
    try {
      const senders = await fetchVerifiedSenders();
      const list = Array.isArray(senders) ? senders : (senders?.senders || []);
      sender.verified = list.some(
        (s) => (s.email || '').toLowerCase() === sender.email.toLowerCase(),
      );
    } catch {
      sender.verified = null;
    }
  }

  let webhookConfigured = false;
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'integrations.webhook' } });
    webhookConfigured = Boolean(row?.value?.url);
  } catch { /* setting table unreachable — treat as not configured */ }

  return { provider, sender, webhook: { configured: webhookConfigured } };
}

// Boot-time, non-blocking. Turns the class of "why won't it send?" failures
// into a single clear log line at startup.
export async function logProviderStatus() {
  try {
    const s = await getSetupStatus();
    if (!s.provider.configured) {
      console.log('[setup] Email provider: no BREVO_API_KEY — DRY-RUN (emails are logged, not sent).');
      return;
    }
    if (s.provider.dryRun) {
      console.log('[setup] Email provider: DEMO_MODE on — DRY-RUN (emails are logged, not sent).');
      return;
    }
    if (s.provider.valid) {
      console.log(`[setup] Email provider: key OK (account ${s.provider.account}${s.provider.plan ? `, ${s.provider.plan} plan` : ''}).`);
      if (s.sender.configured && s.sender.verified === false) {
        console.log(`[setup] Warning: sender "${s.sender.email}" is not a verified Brevo sender — sends may bounce or land in spam.`);
      }
      return;
    }
    console.log(`[setup] Email provider: API KEY REJECTED — ${s.provider.error}`);
    console.log('[setup] Tip: a BREVO_API_KEY exported in your shell overrides .env (dotenv never overrides an already-set var). Run `unset BREVO_API_KEY`, then restart.');
  } catch (error) {
    console.log('[setup] Provider status check failed:', error.message);
  }
}
