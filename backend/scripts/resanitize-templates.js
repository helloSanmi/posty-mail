// One-shot cleanup: re-runs sanitizeEmailHtml across every stored template.
//
// Why: an earlier version of sanitize.js let <head>/<title>/<meta> text leak into
// the body of saved templates. New saves are clean, but rows persisted before the
// fix still hold the leaked content. Run this once to flush them out.
//
// Usage: node backend/scripts/resanitize-templates.js [--dry]
//   --dry  print what would change, but do not write
//
// Safe to run multiple times: idempotent on already-clean rows.

import { prisma } from '../lib/db.js';
import { sanitizeEmailHtml, sanitizeSubject } from '../lib/sanitize.js';

const dryRun = process.argv.includes('--dry');

async function main() {
  const templates = await prisma.template.findMany({
    select: { id: true, name: true, subject: true, html: true, data: true },
  });

  let changed = 0;
  let unchanged = 0;

  for (const t of templates) {
    const cleanHtml = sanitizeEmailHtml(t.html || '');
    const cleanSubject = sanitizeSubject(t.subject || '');
    const htmlDiffers = cleanHtml !== (t.html || '');
    const subjectDiffers = cleanSubject !== (t.subject || '');

    if (!htmlDiffers && !subjectDiffers) {
      unchanged += 1;
      continue;
    }

    changed += 1;
    const before = (t.html || '').slice(0, 80).replace(/\s+/g, ' ');
    const after = cleanHtml.slice(0, 80).replace(/\s+/g, ' ');
    console.log(`\n[${dryRun ? 'DRY' : 'FIX'}] ${t.id}  (${t.name})`);
    if (htmlDiffers) {
      console.log(`  html:    "${before}…"`);
      console.log(`        →  "${after}…"`);
      console.log(`  bytes:   ${(t.html || '').length} → ${cleanHtml.length}`);
    }
    if (subjectDiffers) {
      console.log(`  subject: "${t.subject}" → "${cleanSubject}"`);
    }

    if (dryRun) continue;

    // Keep the JSON `data` blob in sync so reads (which spread `data` first) don't
    // resurrect the stale html.
    const nextData = { ...(t.data || {}), html: cleanHtml, subject: cleanSubject };

    await prisma.template.update({
      where: { id: t.id },
      data: { html: cleanHtml, subject: cleanSubject, data: nextData },
    });
  }

  console.log(`\nDone. ${changed} updated, ${unchanged} already clean${dryRun ? ' (dry run — no writes)' : ''}.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
