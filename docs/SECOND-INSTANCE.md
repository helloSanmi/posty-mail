# Running a second business on the same VM

Two independent Posty installs on one box: separate code checkout, separate
database, separate pm2 process, separate domain. They share only the machine
(and optionally the Brevo account).

This is the "Option A" model: each install is a normal single-tenant Posty, so
nothing about it depends on unfinished multi-workspace features.

## End state

|                  | Business A (existing)              | Business B (new)                   |
| ---------------- | ---------------------------------- | ---------------------------------- |
| Checkout         | `~/posty`                          | `~/posty-b`                        |
| Port             | `4010`                             | `4011`                             |
| Database         | `campaign_app`                     | `business_b_app`                   |
| pm2 app          | `posty`                            | `posty-b`                          |
| Domain           | `mail.business-a.com`              | `mail.business-b.com`              |
| Deploy           | `./deploy.sh`                      | `./deploy.sh posty-b`              |

Both talk to the **same** Postgres server on `127.0.0.1:5432`, just different
databases. One Postgres container is enough — do **not** run `npm run docker:db`
from the second checkout (see Gotchas).

---

## 0. Confirm how Business A is exposed

Don't assume. Check which one is actually terminating HTTPS today:

```bash
systemctl is-active nginx cloudflared 2>/dev/null
sudo nginx -T 2>/dev/null | grep -E 'server_name|proxy_pass'   # if nginx
cloudflared tunnel list 2>/dev/null                            # if tunnel
```

Follow **6a** (nginx) or **6b** (Cloudflare Tunnel) below to match.

---

## 1. Create Business B's database

Run this against the **existing** Postgres container. A separate role means
B's credentials cannot reach A's data.

```bash
docker exec -i campaign-postgres psql -U campaign -d campaign_app <<'SQL'
CREATE USER business_b WITH PASSWORD 'pick-a-strong-password';
CREATE DATABASE business_b_app OWNER business_b;
SQL
```

Verify:

```bash
docker exec -i campaign-postgres psql -U campaign -c '\l' | grep business_b_app
```

## 2. Second checkout

```bash
cd ~
git clone https://github.com/helloSanmi/posty-mail.git posty-b
cd posty-b
```

## 3. Business B's `.env`

Write it by hand — do **not** copy `.env.example` verbatim (it sets
`VITE_API_URL=http://localhost:4010`, which would get baked into the
production bundle and break the browser's API calls).

```bash
cat > .env <<'ENV'
NODE_ENV=production
PORT=4011

PUBLIC_BASE_URL=https://mail.business-b.com

DATABASE_URL=postgresql://business_b:pick-a-strong-password@localhost:5432/business_b_app?schema=public

# MUST be different from Business A's — see Gotchas.
JWT_SECRET=

BREVO_API_KEY=
BREVO_WEBHOOK_TOKEN=

ALLOW_OPEN_SIGNUP=false
ALLOW_PASSWORD_RESET=false
ENV
```

Fill the two secrets with fresh values:

```bash
openssl rand -base64 48   # -> JWT_SECRET
openssl rand -hex 24      # -> BREVO_WEBHOOK_TOKEN
```

Leave `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` **unset** — set the sender from
Settings after first login. A placeholder there overrides "unset" and mail goes
out under the placeholder.

## 4. Install, generate, migrate, build

```bash
npm ci
npm run db:generate      # REQUIRED — npm 12+ blocks install scripts, so this
                         # does not happen automatically
npm run db:deploy
npm run build
```

## 5. Start it under its own pm2 name

```bash
pm2 start backend/server.js --name posty-b
pm2 save
pm2 logs posty-b --lines 30
```

In the logs you should see the boot check confirm the provider:

```
[setup] Email provider: key OK (account ..., ... plan).
```

Sanity-check the port directly, bypassing the proxy:

```bash
curl -s localhost:4011/api/health
```

## 6a. Expose it — nginx

```nginx
# /etc/nginx/sites-available/posty-b
server {
    listen 80;
    server_name mail.business-b.com;

    client_max_body_size 12M;   # CSV / XLSX contact imports

    location / {
        proxy_pass http://127.0.0.1:4011;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/posty-b /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d mail.business-b.com      # HTTPS
```

## 6b. Expose it — Cloudflare Tunnel

Add an ingress rule for the new hostname, pointing at B's port. Keep A's rule
untouched, and keep `http_status:404` last:

```yaml
# ~/.cloudflared/config.yml
ingress:
  - hostname: mail.business-a.com
    service: http://localhost:4010
  - hostname: mail.business-b.com
    service: http://localhost:4011
  - service: http_status:404
```

```bash
cloudflared tunnel route dns <TUNNEL_NAME> mail.business-b.com
sudo systemctl restart cloudflared
```

## 7. DNS

Point `mail.business-b.com` at the VM (nginx: an `A` record to the VM's IP;
Cloudflare Tunnel: the `route dns` command above creates the CNAME for you).

## 8. Brevo

One Brevo account can serve both businesses:

1. **Add and authenticate B's domain** (Senders, Domains & Dedicated IPs →
   Domains). Add the SPF/DKIM/DMARC records it gives you to
   `business-b.com`'s DNS. This is what makes B's mail authenticate as B.
2. **Verify B's sender address**, then set it in Posty: Settings →
   Connections → Sender.
3. **Webhook.** Brevo fires events for the whole account, so if you register
   `https://mail.business-b.com/api/webhooks/brevo?token=<B's token>`, that
   instance receives A's events too — and drops them, because it resolves each
   event's `campaign:<uuid>` tag against its own database and finds nothing.
   That guard is already in the code.
   - If Brevo lets you keep **two** webhooks, register one per instance and
     both get live events.
   - If it only allows **one**, the instance without it falls back to polling
     Brevo's API (`BREVO_SYNC_INTERVAL_MINUTES`, default 5). Reports lag by up
     to that interval; nothing is lost.
4. Confirm in **Settings → Connections → Setup status** that B reads
   *Ready to send*.

## 9. First login

Open `https://mail.business-b.com`. The first account you create becomes the
admin. With `ALLOW_OPEN_SIGNUP=false`, everyone after that is invited from
Admin → Team members.

---

## Updating later

From each checkout, naming its own pm2 app:

```bash
cd ~/posty   && ./deploy.sh            # Business A
cd ~/posty-b && ./deploy.sh posty-b    # Business B
```

---

## Gotchas

**`JWT_SECRET` must differ between the two installs.** This is the important
one. On a fresh install the first user lands in the account with id `default`,
so *both* installs have a `default` account. If they share a signing secret, a
token minted by A verifies on B and resolves to the same account id — meaning
one business's login can read the other's data. Different secrets, always.

**Never run `npm run docker:db` from the second checkout.** `docker-compose.yml`
pins `container_name: campaign-postgres`, the volume name, and
`127.0.0.1:5432`. From a second directory it collides with the running
container instead of creating anything useful. Business B uses the existing
Postgres via its own `DATABASE_URL` (step 1).

**Pass the pm2 name when deploying B.** `./deploy.sh` with no argument targets
`posty` — from B's directory that would pull and build B's code, then restart
*A*, leaving B on stale code. The script echoes the target name at the top;
read it.

**Ports must differ** (`4010` / `4011`), and each `.env` needs its own
`PUBLIC_BASE_URL` — that value generates unsubscribe links and the image URLs
embedded in emails, so a wrong one sends recipients to the other business.

**Don't copy `.env.example` for production.** It sets
`VITE_API_URL=http://localhost:4010`, which Vite bakes into the bundle at
build time; the browser would then call `localhost` and every request would
fail. Leave it unset so the frontend uses relative `/api` paths.

**Resource ceiling.** Two Node processes plus Postgres on a 1 GB box is tight.
Watch it with `pm2 status` and `free -m`; 2 GB is more comfortable.
