// Template persistence. Templates are the reusable email shells (subject +
// HTML + plain text + optional logoUrl + ad-hoc `data` JSON for extras).
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

export async function listTemplates() {
  const rows = await prisma.template.findMany({ orderBy: { updatedAt: 'desc' } });
  return rows.map(templateFromDb);
}

export async function upsertTemplate(template) {
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
    },
    update: {
      name: template.name,
      subject: template.subject,
      html: template.html,
      text: template.text,
      logoUrl: template.logoUrl || '',
      data: template,
    },
  });
}

export async function deleteTemplate(id) {
  return prisma.template.deleteMany({ where: { id } });
}
