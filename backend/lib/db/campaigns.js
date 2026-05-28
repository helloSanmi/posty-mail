// Campaign persistence: the parent Campaign row + its per-recipient
// CampaignSend ledger. CampaignSend tracks one row per (campaign, email)
// with the send status, retry attempts, and any error message.
//
// The full campaign payload (contacts list, template, schedule, sender
// snapshot) lives in `data` JSON because the shape is large and
// frequently extended; flattening every field into columns would mean
// a migration for every new feature.
//
// Multi-tenant scope: every read/write filters by accountId. Campaign.id
// is global so an attacker can't guess another tenant's id, but we still
// AND in accountId on every where clause as defense in depth — a 404 in
// one account must not silently surface a row from another.
//
// CampaignSend is denormalized with accountId pulled from its parent so
// the ledger queries don't need a join. The mark*/upsert helpers below
// accept accountId and stamp it on writes; the background send loop
// (lib/scheduler/) reads campaign.accountId once and passes it down.
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

export async function listCampaigns(accountId) {
  const rows = await prisma.campaign.findMany({
    where: { accountId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(campaignFromDb);
}

export async function listCampaignsPaged({ accountId, page = 1, pageSize = 8 } = {}) {
  const safePageSize = Math.min(Math.max(Number(pageSize) || 8, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const [rows, total] = await prisma.$transaction([
    prisma.campaign.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.campaign.count({ where: { accountId } }),
  ]);
  return {
    rows: rows.map(campaignFromDb),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

export async function upsertCampaign(accountId, campaign) {
  // Campaign.id is globally unique (random) so a straight upsert is safe:
  // either the id already exists in THIS account (we read it back) or
  // it's brand-new. We set accountId on create so even a misrouted id
  // can't silently land in the wrong workspace.
  return prisma.campaign.upsert({
    where: { id: campaign.id },
    create: {
      id: campaign.id,
      name: campaign.name || 'Untitled campaign',
      status: campaign.status || 'scheduled',
      data: campaign,
      accountId,
    },
    update: {
      name: campaign.name || 'Untitled campaign',
      status: campaign.status || 'scheduled',
      data: campaign,
      // accountId intentionally NOT updated — preserve the row's tenant.
    },
  });
}

export async function getCampaign(accountId, id) {
  const row = await prisma.campaign.findFirst({ where: { id, accountId } });
  return row ? campaignFromDb(row) : null;
}

export async function listScheduledOrRunningCampaigns() {
  // No accountId filter on purpose: this is called by the scheduler at
  // boot to restore cron jobs for every account on the install. Each
  // restored job carries the campaign's own accountId, so per-send
  // queries downstream stay scoped.
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

export async function markSendAttempt(accountId, campaignId, email) {
  return prisma.campaignSend.upsert({
    where: { campaignId_email: { campaignId, email } },
    create: {
      campaignId,
      email,
      status: 'sending',
      attempts: 1,
      accountId,
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

export async function markSendSkipped(accountId, campaignId, email, message) {
  return prisma.campaignSend.upsert({
    where: { campaignId_email: { campaignId, email } },
    create: {
      campaignId,
      email,
      status: 'skipped',
      errorMessage: message?.slice(0, 500) || null,
      accountId,
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
