// Draft persistence. A Draft is the autosaved snapshot of an in-progress
// campaign in the Builder. The full draft state lives in `data` (JSON);
// `name` is a duplicate of `data.name` for the Drafts-list display.
import { prisma } from './prisma.js';

export function draftFromDb(draft) {
  return {
    ...(draft.data || {}),
    id: draft.id,
    name: draft.name || draft.data?.name || 'Draft',
    updatedAt: draft.updatedAt?.toISOString?.() || draft.updatedAt,
  };
}

export async function listDrafts() {
  const rows = await prisma.draft.findMany({ orderBy: { updatedAt: 'desc' } });
  return rows.map(draftFromDb);
}

export async function upsertDraft(draft) {
  return prisma.draft.upsert({
    where: { id: draft.id },
    create: {
      id: draft.id,
      name: draft.name || draft.form?.name || 'Draft',
      data: draft,
    },
    update: {
      name: draft.name || draft.form?.name || 'Draft',
      data: draft,
    },
  });
}
