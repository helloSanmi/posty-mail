import crypto from 'node:crypto';

function timingSafeEqualString(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function verifyBrevoWebhook(req, res, next) {
  const token = process.env.BREVO_WEBHOOK_TOKEN;
  const secret = process.env.BREVO_WEBHOOK_SECRET;

  if (!token && !secret) {
    if (process.env.NODE_ENV === 'production') {
      res.status(503).json({
        error: 'Webhook is not configured. Set BREVO_WEBHOOK_TOKEN or BREVO_WEBHOOK_SECRET.',
      });
      return;
    }
    // In dev, accept unsigned but log once.
    if (!verifyBrevoWebhook._warned) {
      console.warn('[security] Brevo webhook is unverified. Set BREVO_WEBHOOK_TOKEN or BREVO_WEBHOOK_SECRET');
      verifyBrevoWebhook._warned = true;
    }
    return next();
  }

  if (token) {
    const provided = String(req.query.token || req.headers['x-webhook-token'] || '');
    if (!provided || !timingSafeEqualString(provided, token)) {
      res.status(401).json({ error: 'Invalid webhook token' });
      return;
    }
  }

  if (secret) {
    const signature = req.headers['x-brevo-signature'] || req.headers['x-mailin-signature'];
    if (!signature || !req.rawBody) {
      res.status(401).json({ error: 'Missing webhook signature' });
      return;
    }
    const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    if (!timingSafeEqualString(String(signature), expected)) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }
  }

  return next();
}
