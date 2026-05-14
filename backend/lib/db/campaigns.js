// Campaign persistence: the parent Campaign row + its per-recipient
// CampaignSend ledger. CampaignSend tracks one row per (campaign, email)
// with the send status, retry attempts, and any error message.
//
// The full campaign payload (contacts list, template, schedule, sender
// snapshot) lives in `data` JSON because the shape is large and
// frequently extended; flattening every field into columns would mean
// a migration for every new feature.
import { prisma } from './prisma.js';

export function campaignFromDb(campaign) {
  return {
    ...(campaign.data || {}),
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    createdAt: campaign.createdAt?.toISOString?.() || campaign.createdAt,
    updatedAt: campaign.updatedAt?.toISOString?.() || campaign.updatedAt,
  };
}

export async function listCampaigns() {
  const rows = await prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map(campaignFromDb);
}

export async function listCampaignsPaged({ page = 1, pageSize = 8 } = {}) {
  const safePageSize = Math.min(Math.max(Number(pageSize) || 8, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const [rows, total] = await prisma.$transaction([
    prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.campaign.count(),
  ]);
  return {
    rows: rows.map(campaignFromDb),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

export async function upsertCampaign(campaign) {
  return prisma.campaign.upsert({
    where: { id: campaign.id },
    create: {
      id: campaign.id,
      name: campaign.name || 'Untitled campaign',
      status: campaign.status || 'scheduled',
      data: campaign,
    },
    update: {
      name: campaign.name || 'Untitled campaign',
      status: campaign.status || 'scheduled',
      data: campaign,
    },
  });
}

export async function getCampaign(id) {
  const row = await prisma.campaign.findUnique({ where: { id } });
  return row ? campaignFromDb(row) : null;
}

export async function listScheduledOrRunningCampaigns() {
  const rows = await prisma.campaign.findMany({
    where: { status: { in: ['scheduled', 'running'] } },
  });
  return rows.map(campaignFromDb);
}

// ---- CampaignSend ledger -------------------------------------------------

export async function getSendRecord(campaignId, email) {
  return prisma.campaignSend.findUnique({
    where: { campaignId_email: { campaignId, email } },
  });
}

export async function markSendAttempt(campaignId, email) {
  return prisma.campaignSend.upsert({
    where: { campaignId_email: { campaignId, email } },
    create: {
      campaignId,
      email,
      status: 'sending',
      attempts: 1,
    },
    update: {
      status: 'sending',
      attempts: { increment: 1 },
    },
  });
}

export async function markSendSucceeded(campaignId, email, brevoMessageId = null) {
  return prisma.campaignSend.update({
    where: { campaignId_email: { campaignId, email } },
    data: {
      status: 'sent',
      brevoMessageId,
      errorMessage: null,
      sentAt: new Date(),
    },
  });
}

export async function markSendFailed(campaignId, email, message) {
  return prisma.campaignSend.update({
    where: { campaignId_email: { campaignId, email } },
    data: {
      status: 'failed',
      errorMessage: message?.slice(0, 500) || 'unknown error',
    },
  });
}

export async function markSendSkipped(campaignId, email, message) {
  return prisma.campaignSend.upsert({
    where: { campaignId_email: { campaignId, email } },
    create: {
      campaignId,
      email,
      status: 'skipped',
      errorMessage: message?.slice(0, 500) || null,
    },
    update: {
      status: 'skipped',
      errorMessage: message?.slice(0, 500) || null,
    },
  });
}

export async function listCampaignSends(campaignId) {
  return prisma.campaignSend.findMany({
    where: { campaignId },
    orderBy: { updatedAt: 'desc' },
  });
}
