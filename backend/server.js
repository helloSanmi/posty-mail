import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from './lib/db.js';
import { requireAuth } from './lib/auth.js';
import { attachPermissions, permissionGate, ensureAllAccountsSeeded } from './lib/permissions.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerRoleRoutes } from './routes/roles.js';
import { registerSuperAdminRoutes } from './routes/superAdmin.js';
import { registerAudienceRoutes } from './routes/audiences.js';
import { registerCampaignRoutes, restoreCampaignJobs } from './routes/campaigns.js';
import { registerContactRoutes } from './routes/contacts.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerSegmentRoutes } from './routes/segments.js';
import { registerSequenceRoutes } from './routes/sequences.js';
import { registerSequenceRunner } from './lib/sequenceRunner.js';
import {
  registerIntegrationRoutes,
  registerPublicIntegrationRoutes,
} from './routes/integrations.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerEventSync, syncBrevoEvents } from './lib/syncBrevoEvents.js';
import { asyncRoute } from './utils/store.js';

const app = express();
const port = Number(process.env.PORT || 4010);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.join(__dirname, 'uploads');
const logoRoot = path.join(uploadRoot, 'logos');
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Build the CORS allowlist from three sources, in order:
//   1. Explicit CORS_ORIGIN env (comma-separated). Highest priority, catches anything custom.
//   2. PUBLIC_BASE_URL. Auto-included so requests from the same host (e.g. when the
//      tunnel/CDN serves both the API and the frontend) work without extra config.
//   3. Vite dev server origins. Auto-included in development only.
// In production we still require at least one of (CORS_ORIGIN, PUBLIC_BASE_URL) to be
// set explicitly; refusing wide-open CORS if both are missing.
const corsAllowlist = new Set();
process.env.CORS_ORIGIN?.split(',').map((value) => value.trim()).filter(Boolean)
  .forEach((origin) => corsAllowlist.add(origin.replace(/\/$/, '')));
if (process.env.PUBLIC_BASE_URL) {
  corsAllowlist.add(process.env.PUBLIC_BASE_URL.replace(/\/$/, ''));
}
if (!isProduction) {
  corsAllowlist.add('http://localhost:5173');
  corsAllowlist.add('http://127.0.0.1:5173');
}
if (isProduction && corsAllowlist.size === 0) {
  console.error('Set CORS_ORIGIN or PUBLIC_BASE_URL in production. Refusing to start.');
  process.exit(1);
}
const corsAllowlistArray = [...corsAllowlist];
app.use(cors({
  origin: corsAllowlistArray.length ? corsAllowlistArray : true,
  credentials: false,
}));

// Capture raw body so we can verify webhook HMAC signatures.
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use('/uploads', express.static(uploadRoot));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProduction ? 240 : 1200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

// Public subscribe widget. Lower cap than the general API since this is
// open to the world: 30 attempts per IP per minute is enough for a legitimate
// busy form, well short of what a scraper would need to harvest a list.
const subscribeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many subscribe attempts. Try again in a minute.' },
});

app.use('/api', apiLimiter);
app.use('/api/webhooks', webhookLimiter);
app.use('/api/public/subscribe', subscribeLimiter);

app.get('/api/health', asyncRoute(async (_req, res) => {
  let databaseConnected = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseConnected = true;
  } catch {
    databaseConnected = false;
  }
  res.json({
    ok: true,
    databaseConnected,
    brevoConfigured: Boolean(process.env.BREVO_API_KEY),
    // DEMO_MODE flips the UI into a "this is a sandbox" state. The flag
    // also makes the Brevo client refuse real sends (dry-run only) — see
    // brevoClient.js — so it's safe to expose unauthenticated.
    demoMode: Boolean(process.env.DEMO_MODE),
  });
}));

registerAuthRoutes(app);
registerPublicIntegrationRoutes(app);

// Everything below requires a valid Bearer token
app.use('/api', requireAuth);
// …and carries the caller's resolved area permissions (req.user.permissions),
// enforced centrally by permissionGate before any route handler runs.
app.use('/api', attachPermissions);
app.use('/api', permissionGate);

registerAdminRoutes(app);
registerRoleRoutes(app);
registerSuperAdminRoutes(app);
registerContactRoutes(app);
registerNotificationRoutes(app);
registerSegmentRoutes(app);
registerSequenceRoutes(app);
registerAudienceRoutes(app);
registerCampaignRoutes(app);
registerTemplateRoutes(app);
registerIntegrationRoutes(app, { logoRoot, publicBaseUrl });

// Serve the built frontend (single-process deploy). When `npm run build`
// has produced ../dist, the backend serves it directly so the whole app
// runs as ONE process on ONE port — no separate static host, no CORS.
// In dev this directory doesn't exist (Vite serves the UI on :5173), so
// the block is skipped and nothing changes. All API + public routes are
// registered ABOVE, so they always win over the SPA fallback below.
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback: any GET that isn't an API or uploads path and wasn't
  // matched by a real route falls through to index.html so client-side
  // routing (/, /contacts, /campaigns/:id, …) works on hard refresh.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      next();
      return;
    }
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.message || 'Server error',
  });
});

app.listen(port, () => {
  console.log(`Campaign API running on ${publicBaseUrl}`);
});

restoreCampaignJobs().catch((error) => {
  console.error('Could not restore scheduled campaigns', error);
});

// Ensure every account has its built-in roles (admin/editor/viewer). Seeds
// installs that predate RBAC without a data migration; idempotent, so safe
// on every boot. New accounts also get seeded at signup.
ensureAllAccountsSeeded().catch((error) => {
  console.error('Could not seed account roles', error);
});

// Drip-sequence runner. Fires every 5 minutes via node-cron; reads
// SequenceEnrollment rows whose nextRunAt has elapsed and sends the next
// step. Safe to start unconditionally — if no sequences exist, every tick
// is a cheap no-op SELECT.
registerSequenceRunner();

// Catch up on any Brevo events that fired while we were down. Non-blocking.
// startup is unaffected if Brevo is unreachable. Idempotent thanks to the
// Event.externalId unique index, so safe to run on every boot.
syncBrevoEvents().catch((error) => {
  console.error('[sync] Brevo event catch-up failed:', error.message);
});

// Then keep syncing on an interval. Essential when multiple deployments
// share one Brevo account: only one can hold Brevo's single webhook URL,
// so the others rely on this poll to stay current (each keeps only its own
// events via the resolveEventAccountId guard). No-ops without an API key.
registerEventSync();
