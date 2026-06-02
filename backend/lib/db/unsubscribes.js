// Unsubscribe / suppression list. Two-way mirror with Contact.consent:
//   - Adding to the suppression list also flips the matching Contact's
//     consent to 'no' so the UI shows the person as opted-out.
//   - Removing from the list (restoreContactSubscription) flips consent
//     back to 'yes'.
// The list is queried at send-time (campaign loop + sequence runner) to
// skip recipients regardless of group/segment membership.
//
// Multi-tenant scoping: Unsubscribe has a UUID PK + composite unique
// ([accountId, email]), so the same address can be suppressed
// independently per workspace. Every email lookup uses the composite key
// (accountId_email). Reads stay scoped to the caller's account.
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
  // Per-account suppression via the composite unique ([accountId, email]).
  // The same address can be suppressed in multiple workspaces, each as its
  // own row, so there's no cross-account collision to guard against.
  const saved = await prisma.unsubscribe.upsert({
    where: { accountId_email: { accountId, email: item.email } },
    create: {
      email: item.email,
      reason: item.reason || '',
      accountId,
    },
    update: {
      reason: item.reason || '',
      unsubscribedAt: new Date(),
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
