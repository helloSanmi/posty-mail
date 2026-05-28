// Template persistence. Templates are the reusable email shells (subject +
// HTML + plain text + optional logoUrl + ad-hoc `data` JSON for extras).
//
// Multi-tenant scope: every read/write filters by accountId. Template.id
// is a `custom-<uuid>` string the route mints, so collisions across
// accounts are unlikely but possible if a tenant supplies a hand-picked
// id. Routes that 404 must AND in accountId to stay safe.
import { prisma } from './prisma.js';

export function templateFromDb(template) {
  return {
    ...(template.data || {}),
    id: template.id,
    name: template.name,
    subject: template.subject,
    html: template.html,
    text: template.text,
    logoUrl: template.logoUrl || '',
    updatedAt: template.updatedAt?.toISOString?.() || template.updatedAt,
  };
}

export async function listTemplates(accountId) {
  const rows = await prisma.template.findMany({
    where: { accountId },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map(templateFromDb);
}

export async function upsertTemplate(accountId, template) {
  return prisma.template.upsert({
    where: { id: template.id },
    create: {
      id: template.id,
      name: template.name,
      subject: template.subject,
      html: template.html,
      text: template.text,
      logoUrl: template.logoUrl || '',
      data: template,
      accountId,
    },
    update: {
      name: template.name,
      subject: template.subject,
      html: template.html,
      text: template.text,
      logoUrl: template.logoUrl || '',
      data: template,
      // accountId intentionally NOT updated.
    },
  });
}

export async function deleteTemplate(accountId, id) {
  return prisma.template.deleteMany({ where: { id, accountId } });
}
