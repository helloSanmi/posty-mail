// The single Prisma client instance shared across every db/* domain module.
// Imported from sibling files so a circular import via the re-export shim
// (../db.js) doesn't happen at module init time.
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
