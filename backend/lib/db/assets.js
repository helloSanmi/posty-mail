// Asset persistence: uploaded logos, banner images, etc. The actual file
// lives on disk (backend/uploads/...); this row keeps the metadata + the
// public URL the templates use.
import { prisma } from './prisma.js';

export async function listAssets(kind) {
  return prisma.asset.findMany({
    where: kind ? { kind } : undefined,
    orderBy: { createdAt: 'desc' },
  });
}

export async function createAsset(asset) {
  return prisma.asset.create({ data: asset });
}

export async function getAsset(id) {
  return prisma.asset.findUnique({ where: { id } });
}

export async function deleteAsset(id) {
  return prisma.asset.delete({ where: { id } });
}
