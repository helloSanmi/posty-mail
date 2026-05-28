// Asset persistence: uploaded logos, banner images, etc. The actual file
// lives on disk (backend/uploads/...); this row keeps the metadata + the
// public URL the templates use.
//
// Multi-tenant scope: scoped by accountId. The on-disk filenames stay
// shared across the install (everything lands under /uploads/logos/...)
// because the URLs are baked into already-sent emails; only the
// metadata row gates who sees which asset in the picker.
import { prisma } from './prisma.js';

export async function listAssets(accountId, kind) {
  return prisma.asset.findMany({
    where: { accountId, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createAsset(accountId, asset) {
  return prisma.asset.create({ data: { ...asset, accountId } });
}

export async function getAsset(accountId, id) {
  return prisma.asset.findFirst({ where: { id, accountId } });
}

export async function deleteAsset(accountId, id) {
  // deleteMany scopes by id+accountId in a single statement and is safe
  // when the row doesn't exist (returns count: 0). Avoids a separate
  // findFirst race.
  return prisma.asset.deleteMany({ where: { id, accountId } });
}
