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
export async function setAudienceDisabled(id, disabled) {
  const row = await prisma.audience.update({
    where: { id },
    data: { disabled: Boolean(disabled) },
  });
  return audienceFromDb(row);
}

// Rename only. Kept separate from upsertAudience because that one rewrites
// the membership list too, which is the wrong behavior for an in-place
// rename triggered from the Groups sidebar.
export async function renameAudience(id, name) {
  const row = await prisma.audience.update({
    where: { id },
    data: { name },
  });
  return audienceFromDb(row);
}

// List + prune. On read we drop any contactEmail entries whose Contact row
// no longer exists (e.g., contact was deleted but the membership lingered).
// The prune happens in the background so the read returns quickly.
export async function listAudiences() {
  const [existingContacts, rows] = await Promise.all([
    prisma.contact.findMany({ select: { email: true } }),
    prisma.audience.findMany({ orderBy: { updatedAt: 'desc' } }),
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

export async function getAudience(id) {
  const row = await prisma.audience.findUnique({ where: { id } });
  return row ? audienceFromDb(row) : null;
}

export async function deleteAudience(id) {
  return prisma.audience.deleteMany({ where: { id } });
}

export async function patchAudienceMembers(id, { add = [], remove = [] }) {
  const existing = await prisma.audience.findUnique({ where: { id } });
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
  // to total contacts.
  if (addNormalized.length) {
    const removeSet = new Set(addNormalized);
    const others = await prisma.audience.findMany({ where: { id: { not: id } } });
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

export async function listAudienceContacts(id) {
  const audience = await prisma.audience.findUnique({ where: { id } });
  if (!audience) return null;
  const emails = audience.contactEmails || [];
  if (!emails.length) return [];
  const rows = await prisma.contact.findMany({
    where: { email: { in: emails } },
    orderBy: { savedAt: 'desc' },
  });
  return rows.map(contactFromDb);
}

export async function upsertAudience(audience) {
  return prisma.audience.upsert({
    where: { id: audience.id },
    create: {
      id: audience.id,
      name: audience.name,
      contactEmails: audience.contactEmails || [],
    },
    update: {
      name: audience.name,
      contactEmails: audience.contactEmails || [],
    },
  });
}

export async function findOrCreateAudienceByName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const existing = await prisma.audience.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) return existing;
  return prisma.audience.create({
    data: {
      id: crypto.randomUUID(),
      name: trimmed,
      contactEmails: [],
    },
  });
}

export async function addEmailsToAudience(id, emails) {
  const audience = await prisma.audience.findUnique({ where: { id } });
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
  // as well as overlap between named groups.
  if (normalized.length) {
    const removeSet = new Set(normalized);
    const others = await prisma.audience.findMany({ where: { id: { not: id } } });
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

export async function removeEmailsFromAllAudiences(emails) {
  if (!emails?.length) return 0;
  const set = new Set(emails.map((email) => String(email).trim().toLowerCase()));
  const audiences = await prisma.audience.findMany();
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
