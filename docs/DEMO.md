# Hosting a public Posty demo

A demo instance lets people kick the tyres on Posty without installing it
locally. This doc covers the pieces that make a demo safe to expose publicly.

---

## What demo mode does

When `DEMO_MODE=1` is set in the backend environment:

- **All Brevo calls short-circuit to dry-run.** Even if `BREVO_API_KEY` is
  set (handy for letting visitors see the verified-senders dropdown), no
  email actually goes out and no webhook is registered. See
  `backend/lib/brevoClient.js`.
- **`/api/health` returns `demoMode: true`.** The frontend `DemoBanner`
  reads this and renders a yellow strip at the top of every page:
  *"Demo instance. Sends are dry-run only and the database resets every hour."*
- **The reset script (`backend/scripts/reset-demo.js`) becomes runnable.**
  Without `DEMO_MODE=1` it refuses to run, so an admin can't fat-finger it
  against a real install.

Everything else works normally: the builder, settings, templates, segments,
deliverability checker, etc. Visitors can do real work; it just doesn't mail.

---

## Setup

### 1. Backend env

```env
DATABASE_URL=postgresql://...
JWT_SECRET=<32+ random chars>
PUBLIC_BASE_URL=https://demo.posty.dev
DEMO_MODE=1
# Optional: BREVO_API_KEY for the verified-senders dropdown. No mail goes out.
# BREVO_API_KEY=xkeysib-...
```

### 2. Seed once

```bash
npm run db:deploy
node backend/scripts/reset-demo.js
```

The script wipes user-facing tables (contacts, groups, segments, campaigns,
events, etc.) and seeds 30 sample contacts, 3 groups, 1 segment, and 1
completed campaign with 12 opens + 5 clicks. The `User` and `Setting` tables
are intentionally NOT wiped so the admin login persists across resets.

### 3. Create the admin login

```bash
# Sign up via the UI on first boot. The first user becomes admin.
# Or seed via SQL:
INSERT INTO "User" (id, email, password_hash, name, role, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'demo@posty.dev',
  '<bcrypt hash>',
  'Demo Admin',
  'admin',
  now(),
  now()
);
```

Use a password that's safe to share publicly. The demo admin only has access
to dry-run sends.

### 4. Hourly reset cron

The reset script is idempotent and safe to re-run. Schedule it hourly:

```cron
0 * * * * cd /app && DEMO_MODE=1 node backend/scripts/reset-demo.js >> /var/log/posty-demo-reset.log 2>&1
```

On a container platform (Fly, Railway, Render), use the platform's scheduled
task / cron feature instead of system cron.

---

## What it costs to host

- Render / Railway: free Postgres + small web service tier ≈ free for a
  demo with a few hundred visits/day.
- Fly.io: 1× shared-cpu-1x VM + 3GB pg volume comfortably handles it.

Storage scales with `Event` and `CampaignSend` rows. The hourly reset keeps
both small, so the box stays light.

---

## Customizing the seed

`backend/scripts/reset-demo.js` is intentionally small. Edit it directly if
you want different sample data, more contacts, or pre-populated templates.
Anything you add to the seed will be present on every reset.

If you want to keep `User` and `Setting` rows wiped on reset too (e.g. so the
sender config goes back to "unconfigured" each hour to demo onboarding), add:

```js
await prisma.user.deleteMany({});
await prisma.setting.deleteMany({});
```

just before the seed step. Recreate the admin user afterward.
