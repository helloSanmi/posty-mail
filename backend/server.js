import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from './lib/db.js';
import { requireAuth } from './lib/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAudienceRoutes } from './routes/audiences.js';
import { registerCampaignRoutes, restoreCampaignJobs } from './routes/campaigns.js';
import { registerContactRoutes } from './routes/contacts.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerSegmentRoutes } from './routes/segments.js';
import {
  registerIntegrationRoutes,
  registerPublicIntegrationRoutes,
} from './routes/integrations.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { syncBrevoEvents } from './lib/syncBrevoEvents.js';
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

app.use('/api', apiLimiter);
app.use('/api/webhooks', webhookLimiter);

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
  });
}));

registerAuthRoutes(app);
registerPublicIntegrationRoutes(app);

// Everything below requires a valid Bearer token
app.use('/api', requireAuth);

registerAdminRoutes(app);
registerContactRoutes(app);
registerNotificationRoutes(app);
registerSegmentRoutes(app);
registerAudienceRoutes(app);
registerCampaignRoutes(app);
registerTemplateRoutes(app);
registerIntegrationRoutes(app, { logoRoot, publicBaseUrl });

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

// Catch up on any Brevo events that fired while we were down. Non-blocking.
// startup is unaffected if Brevo is unreachable. Idempotent thanks to the
// Event.externalId unique index, so safe to run on every boot.
syncBrevoEvents().catch((error) => {
  console.error('[sync] Brevo event catch-up failed:', error.message);
});
