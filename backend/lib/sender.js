// Centralized sender resolution. Reads from the Setting table first (admin-
// configurable via Settings UI), then env vars (docker-compose deploys).
//
// Returns null if neither source has a real value. We DO NOT fall back to a
// dummy "campaigns@example.com" address. silently sending under a fake
// identity is worse than refusing to send. Callers must handle the null case
// and surface a clear "configure your sender in Settings" error.
//
// Used by:
//   - the scheduler when a campaign actually fires
//   - the /api/campaigns/test-email handler
//   - the schedule route when persisting a campaign snapshot

import { prisma } from './db.js';

const SETTING_KEY = 'campaign.sender';

function pickValue(stored, envKey) {
  const fromDb = String(stored || '').trim();
  if (fromDb) return fromDb;
  const fromEnv = String(process.env[envKey] || '').trim();
  if (fromEnv) return fromEnv;
  return '';
}

export async function resolveSender() {
  let stored = null;
  try {
    const setting = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    stored = setting?.value || null;
  } catch {
    // DB unavailable at the moment we tried. Fall through to env-only.
  }
  const email = pickValue(stored?.email, 'BREVO_SENDER_EMAIL');
  const name = pickValue(stored?.name, 'BREVO_SENDER_NAME');
  // Both required. A name without an email is unsendable; an email without
  // a name shows up as just the address in Gmail, which we treat as
  // misconfigured rather than "good enough."
  if (!email || !name) return null;
  return { email, name };
}

// Throws a structured 400-shaped error when the sender isn't fully set up.
// Lets routes do `const sender = await requireSender()` without an extra
// null-check at every call site.
export async function requireSender() {
  const sender = await resolveSender();
  if (!sender) {
    const error = new Error('Configure your sender (From name + email) in Settings before sending.');
    error.status = 400;
    error.code = 'SENDER_NOT_CONFIGURED';
    throw error;
  }
  return sender;
}

export async function readSenderSetting() {
  const setting = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  return setting?.value || null;
}

export async function writeSenderSetting({ email, name }) {
  const value = {
    email: String(email || '').trim(),
    name: String(name || '').trim(),
    updatedAt: new Date().toISOString(),
  };
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value },
    update: { value },
  });
  return value;
}
