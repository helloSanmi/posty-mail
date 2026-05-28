// Unsubscribe / suppression list. Two-way mirror with Contact.consent:
//   - Adding to the suppression list also flips the matching Contact's
//     consent to 'no' so the UI shows the person as opted-out.
//   - Removing from the list (restoreContactSubscription) flips consent
//     back to 'yes'.
// The list is queried at send-time (campaign loop + sequence runner) to
// skip recipients regardless of group/segment membership.
//
// Multi-tenant scoping note: Unsubscribe still uses `email` as the global
// primary key in v1 (the migration didn't change PKs). That means two
// accounts can't both have an unsubscribe row for the same email — a
// follow-up migration will switch to UUID PK + @@unique([accountId, email]).
// Until then, upsertUnsubscribe checks for cross-account collisions and
// refuses them rather than overwriting another account's row. Reads stay
// scoped to the caller's account so a tenant can't see another tenant's
// suppression list.
import { prisma } from './prisma.js';

export function unsubscribeFromDb(item) {
  return {
    email: item.email,
    reason: item.reason || '',
    unsubscribedAt: item.unsubscribedAt?.toISOString?.() || item.unsubscribedAt,
  };
}

export async function unsubscribedEmailSet(accountId) {
  const rows = await prisma.unsubscribe.findMany({
    where: { accountId },
    select: { email: true },
  });
  return new Set(rows.map((row) => row.email));
}

export async function listUnsubscribes(accountId) {
  const rows = await prisma.unsubscribe.findMany({
    where: { accountId },
    orderBy: { unsubscribedAt: 'desc' },
  });
  return rows.map(unsubscribeFromDb);
}

export async function upsertUnsubscribe(accountId, item) {
  // Pre-flight: if the email is already on another tenant's suppression
  // list, the v1 schema (global email PK) can't carry a second row. Fail
  // fast with a 409 instead of overwriting their row. The follow-up
  // migration to a composite key removes this restriction.
  const existing = await prisma.unsubscribe.findUnique({ where: { email: item.email } });
  if (existing && existing.accountId !== accountId) {
    const error = new Error(
      `${item.email} is already on another workspace's suppression list. `
      + 'Email addresses are globally unique in this version — per-account suppression '
      + 'will be supported when Unsubscribe storage moves to per-account keys.',
    );
    error.status = 409;
    throw error;
  }

  const saved = await prisma.unsubscribe.upsert({
    where: { email: item.email },
    create: {
      email: item.email,
      reason: item.reason || '',
      accountId,
    },
    update: {
      reason: item.reason || '',
      unsubscribedAt: new Date(),
      // accountId intentionally NOT updated — the precheck above already
      // confirmed the row belongs to THIS account.
    },
  });

  // Reflect the unsubscribe on the Contact row too — so the Contacts page
  // shows the person as opted-out, not still "yes". The Unsubscribe table
  // is the suppression list (queried at send time); Contact.consent is the
  // user's expressed preference. Both should agree after an unsubscribe.
  // No-op when the email isn't in this account's Contacts (e.g. admin-added
  // suppression for a stranger who wrote in to opt out).
  await prisma.contact.updateMany({
    where: { email: item.email, accountId },
    data: { consent: 'no' },
  });

  return saved;
}

// Admin action: re-opt-in a contact who reached out asking to come back.
// Removes them from the Unsubscribe table AND flips Contact.consent back to
// 'yes' so future campaigns include them again. Scoped to this account so a
// tenant can't yank another tenant's row.
export async function restoreContactSubscription(accountId, email) {
  const lower = String(email || '').trim().toLowerCase();
  if (!lower) return { restored: false, reason: 'empty email' };
  const removed = await prisma.unsubscribe.deleteMany({
    where: { email: lower, accountId },
  });
  const updated = await prisma.contact.updateMany({
    where: { email: lower, accountId },
    data: { consent: 'yes' },
  });
  return {
    restored: removed.count > 0 || updated.count > 0,
    removedFromUnsubscribeList: removed.count,
    contactRowsUpdated: updated.count,
  };
}
