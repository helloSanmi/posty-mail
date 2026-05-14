// Preference-center category list. Stored under the Setting table key
// `unsubscribe.categories`. Both the public /unsubscribe page (read) and
// the admin Settings card (read + write) hit the same shape; centralizing
// the access here keeps both halves consistent and avoids the
// "schema-by-coincidence" bugs where the public renderer expects fields
// the admin saver doesn't produce.
import { prisma } from '../../lib/db.js';

const KEY = 'unsubscribe.categories';

// Returns an array of `{ id, label, description? }`. Empty array if nothing
// is set up. Defensive against bad DB content — missing fields get coerced
// to safe defaults, garbage rows are dropped.
export async function readUnsubscribeCategories() {
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    const list = Array.isArray(row?.value?.categories) ? row.value.categories : [];
    return list
      .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
      .map((item) => ({
        id: String(item.id).trim(),
        label: String(item.label || item.id).trim(),
        description: item.description ? String(item.description) : '',
      }))
      .filter((item) => item.id);
  } catch {
    return [];
  }
}

export async function writeUnsubscribeCategories(list) {
  const safe = (Array.isArray(list) ? list : [])
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
    .map((item) => ({
      id: String(item.id).trim().slice(0, 60),
      label: String(item.label || item.id).trim().slice(0, 120),
      description: item.description ? String(item.description).slice(0, 280) : '',
    }))
    .filter((item) => item.id);
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: { categories: safe } },
    update: { value: { categories: safe } },
  });
  return safe;
}
