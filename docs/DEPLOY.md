# Deploying Posty (self-hosted, one server)

Posty is designed to be **self-hosted**: each organization runs its own copy.
This guide gets you from a fresh Linux server to a working install in about
15 minutes. Everything — the app, the database, uploaded images — lives on
**one small VPS** (~$5/month is plenty).

You bring your **own Brevo account** (the free tier sends 300 emails/day).
Nothing routes through anyone else; your data and sending stay entirely on
your server.

---

## What you need

- A Linux server (any provider). A 1 GB / 1 vCPU box is enough. Ubuntu 22.04+
  assumed below.
- A domain or subdomain you control (e.g. `mail.yourcompany.com`).
- A [Brevo](https://www.brevo.com) account + an API key (Settings → SMTP & API
  → API Keys).

---

## 1. Install the basics

```bash
# Node 20+ (via nodesource) and git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Docker (for Postgres) — or install Postgres directly if you prefer
curl -fsSL https://get.docker.com | sudo sh
```

## 2. Get the code

```bash
git clone https://github.com/helloSanmi/posty-mail.git
cd posty-mail
npm install
```

## 3. Start Postgres

The repo ships a `docker-compose.yml` with a ready-to-go Postgres:

```bash
npm run docker:db        # starts postgres on localhost:5432, data persisted in a docker volume
```

> Change the default password in `docker-compose.yml` before exposing anything,
> and match it in `DATABASE_URL` below.

## 4. Configure environment

```bash
cp .env.example .env
nano .env
```

The values that matter for production:

```ini
NODE_ENV=production
PORT=4010

# Your real public URL. Powers image URLs in emails, the unsubscribe link,
# and CORS. MUST be the domain recipients will reach — not localhost.
PUBLIC_BASE_URL=https://mail.yourcompany.com

# Postgres — match docker-compose.yml (or your own Postgres).
DATABASE_URL=postgresql://campaign:campaign_password@localhost:5432/campaign_app?schema=public

# Sign auth tokens. Generate a long random string:  openssl rand -base64 48
JWT_SECRET=paste-a-long-random-string-here

# Brevo
BREVO_API_KEY=your-brevo-api-key
# Leave sender blank — set the From name + email from the Settings page after login.

# Verify incoming Brevo webhooks (required in production). Pick a token and
# append ?token=<value> to the webhook URL you configure in Brevo.
BREVO_WEBHOOK_TOKEN=another-random-string
```

You do **not** need to set `VITE_API_URL` — in a production build the frontend
calls the API on its own origin (single-process deploy, see step 6).

## 5. Create the database schema

```bash
npm run db:deploy        # applies all migrations (prisma migrate deploy)
```

## 6. Build the frontend

```bash
npm run build            # outputs ./dist
```

The backend automatically serves `./dist` when it exists — so the app runs as
**one process on one port**. No separate web server for the frontend, no CORS
to configure.

## 7. Run it as a service (survives crashes + reboots)

Using `pm2`:

```bash
sudo npm install -g pm2
pm2 start backend/server.js --name posty
pm2 save
pm2 startup            # follow the printed command to enable boot start
```

The app is now listening on `http://localhost:4010`.

## 8. Put it on the internet with HTTPS

You need something in front of the app for TLS. Two easy, free options:

**Option A — Caddy (automatic HTTPS, simplest):**

```bash
sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile`:

```
mail.yourcompany.com {
    reverse_proxy localhost:4010
}
```

```bash
sudo systemctl restart caddy
```

Caddy fetches and renews a Let's Encrypt certificate automatically. Point your
domain's DNS A record at the server and you're live.

**Option B — Cloudflare Tunnel (no open ports, works behind NAT):**

```bash
cloudflared tunnel run <your-tunnel>
```

with an ingress rule mapping `mail.yourcompany.com → http://localhost:4010`.

---

## 9. First login + Brevo webhook

1. Visit `https://mail.yourcompany.com` and **sign up** — the first user becomes
   the admin. After that, signup is closed (`ALLOW_OPEN_SIGNUP=false`); add
   teammates from **Admin → New user**.
2. In **Settings → Sender**, set your From name + email (must be a verified
   sender in Brevo).
3. In Brevo, add a **webhook** pointing at
   `https://mail.yourcompany.com/api/webhooks/brevo?token=<BREVO_WEBHOOK_TOKEN>`
   for the events you want tracked (delivered, opened, clicked, bounced,
   unsubscribed). This is what makes the Reports numbers move.

Done. Send a test from the campaign builder to confirm delivery.

---

## Updating later

```bash
cd posty-mail
git pull
npm install
npm run db:deploy        # apply any new migrations
npm run build            # rebuild the frontend
pm2 restart posty
```

---

## Notes

- **Uploaded logos** live on disk under `backend/uploads/`. They persist across
  restarts because they're on the server's disk. If you ever move servers, copy
  that folder along with a database dump.
- **Backups:** dump Postgres regularly — `docker exec campaign-postgres pg_dump -U campaign campaign_app > backup.sql`.
- **Costs:** server (~$5/mo) + your domain + Brevo (free under 300 emails/day).
  Nothing else.
- **One org per install.** This is the self-hosted model — each organization
  deploys its own copy. (The codebase also supports multiple isolated
  workspaces within a single install, but you don't need that for a
  single-organization deployment; it stays dormant.)
