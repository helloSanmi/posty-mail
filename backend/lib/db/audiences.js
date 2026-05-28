// Audience (group) persistence.
//
// Invariant: groups are EXCLUSIVE — a contact lives in exactly one group at
// a time. Adding an email to group X scrubs it from every other group so
// per-group counts always sum to the total Contact count. Tracked in
// addEmailsToAudience + patchAudienceMembers.
//
// Drip-sequence trigger: when emails get added to a group, any active
// Sequence configured to fire on "added to this group" auto-enrolls them.
// The trigger is best-effort — failures get logged and don't fail the
// audience write.
//
// Multi-tenant scope: every read/write filters by accountId. Audience.id
// is a UUID so collisions across accounts are not a concern; the where
// clauses still AND in accountId so a route that 404s on a missing id
// can't accidentally surface another tenant's row.
import { prisma } from './prisma.js';
import { contactFromDb } from './contacts.js';
import { enrollInSequence } from './sequences.js';

export function audienceFromDb(audience) {
  return {
    id: audience.id,
    name: audience.name,
    contactEmails: audience.contactEmails,
    disabled: Boolean(audience.disabled),
    updatedAt: audience.updatedAt?.toISOString?.() || audience.updatedAt,
  };
}

// Toggle the "disabled" flag on a group. Disabled groups stay in the DB
// (members + send-history references) but get filtered out of the campaign
// recipient picker. Used to retire an old group without losing its data.
export async function setAudienceDisabled(accountId, id, disabled) {
  // updateMany lets us scope by both id AND accountId in the WHERE
  // without Prisma rejecting it for missing the composite key. Returns
  // null if no row matched (e.g. wrong account).
  const result = await prisma.audience.updateMany({
    where: { id, accountId },
    data: { disabled: Boolean(disabled) },
  });
  if (!result.count) return null;
  const row = await prisma.audience.findFirst({ where: { id, accountId } });
  return row ? audienceFromDb(row) : null;
}

// Rename only. Kept separate from upsertAudience because that one rewrites
// the membership list too, which is the wrong behavior for an in-place
// rename triggered from the Groups sidebar.
export async function renameAudience(accountId, id, name) {
  const result = await prisma.audience.updateMany({
    where: { id, accountId },
    data: { name },
  });
  if (!result.count) return null;
  const row = await prisma.audience.findFirst({ where: { id, accountId } });
  return row ? audienceFromDb(row) : null;
}

// List + prune. On read we drop any contactEmail entries whose Contact row
// no longer exists (e.g., contact was deleted but the membership lingered).
// The prune happens in the background so the read returns quickly.
export async function listAudiences(accountId) {
  const [existingContacts, rows] = await Promise.all([
    prisma.contact.findMany({ where: { accountId }, select: { email: true } }),
    prisma.audience.findMany({ where: { accountId }, orderBy: { updatedAt: 'desc' } }),
  ]);
  const liveEmails = new Set(existingContacts.map((row) => row.email));

  const cleaned = [];
  const writes = [];
  for (const row of rows) {
    const before = row.contactEmails || [];
    const after = before.filter((email) => liveEmails.has(email));
    if (after.length !== before.length) {
      writes.push(prisma.audience.update({
        where: { id: row.id },
        data: { contactEmails: after },
      }));
    }
    cleaned.push({ ...row, contactEmails: after });
  }

  // Persist the prune in the background; we don't wait for it.
  if (writes.length) {
    Promise.all(writes).catch(() => {});
  }
  return cleaned.map(audienceFromDb);
}

export async function getAudience(accountId, id) {
  const row = await prisma.audience.findFirst({ where: { id, accountId } });
  return row ? audienceFromDb(row) : null;
}

export async function deleteAudience(accountId, id) {
  return prisma.audience.deleteMany({ where: { id, accountId } });
}

export async function patchAudienceMembers(accountId, id, { add = [], remove = [] }) {
  const existing = await prisma.audience.findFirst({ where: { id, accountId } });
  if (!existing) return null;
  const addNormalized = (add || [])
    .map((email) => (email ? String(email).trim().toLowerCase() : ''))
    .filter(Boolean);
  const removeNormalized = (remove || [])
    .map((email) => (email ? String(email).trim().toLowerCase() : ''))
    .filter(Boolean);
  const current = new Set(existing.contactEmails || []);
  addNormalized.forEach((email) => current.add(email));
  removeNormalized.forEach((email) => current.delete(email));
  const updated = await prisma.audience.update({
    where: { id },
    data: { contactEmails: Array.from(current) },
  });
  // Same exclusivity invariant as addEmailsToAudience: when adding emails
  // to this group, scrub them from every other group so counts always sum
  // to total contacts. Scoped to this account so a tenant's add doesn't
  // touch another tenant's groups.
  if (addNormalized.length) {
    const removeSet = new Set(addNormalized);
    const others = await prisma.audience.findMany({ where: { id: { not: id }, accountId } });
    for (const other of others) {
      const before = other.contactEmails || [];
      const after = before.filter((email) => !removeSet.has(email));
      if (after.length !== before.length) {
        await prisma.audience.update({
          where: { id: other.id },
          data: { contactEmails: after },
        });
      }
    }
  }
  return audienceFromDb(updated);
}

export async function listAudienceContacts(accountId, id) {
  const audience = await prisma.audience.findFirst({ where: { id, accountId } });
  if (!audience) return null;
  const emails = audience.contactEmails || [];
  if (!emails.length) return [];
  const rows = await prisma.contact.findMany({
    where: { email: { in: emails }, accountId },
    orderBy: { savedAt: 'desc' },
  });
  return rows.map(contactFromDb);
}

export async function upsertAudience(accountId, audience) {
  // Audience.id is the unique PK across all accounts (UUID). Using a
  // straight upsert is safe — the id either belongs to THIS account (we
  // got it back from a prior read) or it's brand-new (UUID minted by
  // the caller). We still defensively set accountId on create so a
  // misrouted id can't silently land in the wrong workspace.
  return prisma.audience.upsert({
    where: { id: audience.id },
    create: {
      id: audience.id,
      name: audience.name,
      contactEmails: audience.contactEmails || [],
      accountId,
    },
    update: {
      name: audience.name,
      contactEmails: audience.contactEmails || [],
      // accountId intentionally not in update — preserve the row's
      // existing tenant binding.
    },
  });
}

export async function findOrCreateAudienceByName(accountId, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const existing = await prisma.audience.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' }, accountId },
  });
  if (existing) return existing;
  return prisma.audience.create({
    data: {
      id: crypto.randomUUID(),
      name: trimmed,
      contactEmails: [],
      accountId,
    },
  });
}

export async function addEmailsToAudience(accountId, id, emails) {
  const audience = await prisma.audience.findFirst({ where: { id, accountId } });
  if (!audience) return null;
  const set = new Set(audience.contactEmails || []);
  const normalized = (emails || [])
    .map((email) => (email ? String(email).trim().toLowerCase() : ''))
    .filter(Boolean);
  normalized.forEach((email) => set.add(email));
  const updated = await prisma.audience.update({
    where: { id },
    data: { contactEmails: Array.from(set) },
  });
  // Groups are exclusive: a contact lives in exactly one group at a time.
  // When we add an email to group X, scrub it from every OTHER audience so
  // counts always sum to total. This covers the legacy "Unspecified" case
  // as well as overlap between named groups. Scoped to this account.
  if (normalized.length) {
    const removeSet = new Set(normalized);
    const others = await prisma.audience.findMany({ where: { id: { not: id }, accountId } });
    for (const other of others) {
      const before = other.contactEmails || [];
      const after = before.filter((email) => !removeSet.has(email));
      if (after.length !== before.length) {
        await prisma.audience.update({
          where: { id: other.id },
          data: { contactEmails: after },
        });
      }
    }

    // Drip-sequence trigger: enroll each newly-added email into any active
    // sequence configured to fire on "added to this group". Fire-and-forget
    // because enrollment is idempotent (unique constraint dedupes) and we
    // don't want the audience write to block on it. Guarded against an
    // un-migrated install (no Sequence model on the Prisma client).
    if (prisma.sequence) {
      try {
        const sequences = await prisma.sequence.findMany({
          where: {
            triggerType: 'group_added',
            triggerGroupId: id,
            status: 'active',
            accountId,
          },
        });
        if (sequences.length) {
          for (const seq of sequences) {
            for (const email of normalized) {
              try { await enrollInSequence(seq.id, email); } catch { /* idempotent */ }
            }
          }
        }
      } catch (error) {
        // Don't fail the group-add just because the sequence enrollment
        // sidecar broke. Log and continue.
        console.error('[audience] sequence trigger failed:', error.message);
      }
    }
  }
  return updated;
}

export async function removeEmailsFromAllAudiences(accountId, emails) {
  if (!emails?.length) return 0;
  const set = new Set(emails.map((email) => String(email).trim().toLowerCase()));
  const audiences = await prisma.audience.findMany({ where: { accountId } });
  let touched = 0;
  for (const audience of audiences) {
    const before = audience.contactEmails || [];
    const after = before.filter((email) => !set.has(email));
    if (after.length !== before.length) {
      await prisma.audience.update({
        where: { id: audience.id },
        data: { contactEmails: after },
      });
      touched += 1;
    }
  }
  return touched;
}
