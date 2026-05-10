import { prisma } from '../lib/db.js';
import { asyncRoute } from '../utils/store.js';

const NOTIFICATION_LIMIT = 30;

// Mailbox provider link-prefetchers (Gmail, Outlook safelinks, etc.) fire a
// "click" event on every link in every email, with no human involved. We hide
// these from the notifications panel + unread count so the badge tracks real
// engagement, not bot noise. Same logic as src/utils/brevoEvents.js#isBotEvent —
// kept in lockstep with that file.
const BOT_UA_RE = /GoogleImageProxy|YahooMailProxy|OutlookSafelinks|MicrosoftPreview|Slackbot|bot\b|spider|crawler/i;
function isBotEvent(payload) {
  if (!payload) return false;
  const ev = String(payload.event || '').toLowerCase();
  if (!ev.includes('click')) return false;
  const ua = String(payload.user_agent || '');
  if (BOT_UA_RE.test(ua)) return true;
  const ip = String(payload.sending_ip || '');
  if (/^(66\.249|172\.253|209\.85)\./.test(ip)) return true;
  return false;
}

export function registerNotificationRoutes(app) {
  app.get('/api/notifications', asyncRoute(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const lastSeen = user?.notificationsLastSeenAt;
    const clearedAt = user?.notificationsClearedAt;

    // Filter at the DB level so cleared events don't even round-trip.
    // Take more than the visible limit so the bot-event filter below still
    // leaves us with enough real items to show.
    const events = await prisma.event.findMany({
      where: clearedAt ? { receivedAt: { gt: clearedAt } } : undefined,
      orderBy: { receivedAt: 'desc' },
      take: NOTIFICATION_LIMIT * 2,
    });

    const realEvents = events.filter((event) => !isBotEvent(event.payload)).slice(0, NOTIFICATION_LIMIT);

    const items = realEvents.map((event) => ({
      id: event.id,
      kind: 'event',
      provider: event.provider,
      eventName: event.payload?.event || event.provider,
      email: event.payload?.email || null,
      tags: event.payload?.tags || [],
      receivedAt: event.receivedAt.toISOString(),
      isUnread: lastSeen ? event.receivedAt > lastSeen : true,
    }));

    res.json({
      items,
      unreadCount: items.filter((item) => item.isUnread).length,
      lastSeenAt: lastSeen ? lastSeen.toISOString() : null,
      clearedAt: clearedAt ? clearedAt.toISOString() : null,
    });
  }));

  app.post('/api/notifications/read', asyncRoute(async (req, res) => {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { notificationsLastSeenAt: new Date() },
    });
    res.json({ ok: true });
  }));

  // "Clear" hides all current items from the user's panel from now on. The
  // underlying Event rows stay in place for audit / analytics — this is just a
  // per-user view filter. New events arriving after this call will show again.
  app.post('/api/notifications/clear', asyncRoute(async (req, res) => {
    const now = new Date();
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        notificationsClearedAt: now,
        // Bump lastSeen too so the unread badge zeroes out alongside the clear.
        notificationsLastSeenAt: now,
      },
    });
    res.json({ ok: true });
  }));
}
