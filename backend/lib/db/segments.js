// Segment persistence. Segments are dynamic recipient filters; the rules
// engine that translates filter JSON to a Prisma WHERE lives in
// segmentFilter.js. This file just stores and retrieves the rules.
import { prisma } from './prisma.js';

export async function listSegments() {
  const rows = await prisma.segment.findMany({ orderBy: { updatedAt: 'desc' } });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    filter: row.filter,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function upsertSegment(segment) {
  return prisma.segment.upsert({
    where: { id: segment.id },
    create: { id: segment.id, name: segment.name, filter: segment.filter },
    update: { name: segment.name, filter: segment.filter },
  });
}

export async function deleteSegment(id) {
  return prisma.segment.deleteMany({ where: { id } });
}
