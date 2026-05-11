// Centralized sender resolution. Reads from the Setting table first (admin-
// configurable via Settings UI), falls back to env vars (legacy / docker-
// compose deploys), then to a placeholder so test sends without a Brevo key
// don't 500.
//
// Used by both:
//   - the scheduler when assembling a campaign payload
//   - the /api/campaigns/test-email handler

import { prisma } from './db.js';

const SETTING_KEY = 'campaign.sender';

const PLACEHOLDER_EMAIL = 'campaigns@example.com';
const PLACEHOLDER_NAME = 'Campaign Team';

export async function resolveSender() {
  let stored = null;
  try {
    const setting = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    stored = setting?.value || null;
  } catch {
    // DB unavailable at the moment we tried. Fall through to env / defaults.
  }
  const email = stored?.email
    || process.env.BREVO_SENDER_EMAIL
    || PLACEHOLDER_EMAIL;
  const name = stored?.name
    || process.env.BREVO_SENDER_NAME
    || PLACEHOLDER_NAME;
  return { email, name };
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
