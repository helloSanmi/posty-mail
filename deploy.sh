#!/usr/bin/env bash
#
# Posty update + redeploy. Run from the server after pushing to GitHub:
#
#   ./deploy.sh                 # acts on the pm2 app named "posty"
#   ./deploy.sh posty-b         # acts on a second instance
#   PM2_NAME=posty-b ./deploy.sh
#
# IMPORTANT when you run more than one Posty on one box: the pm2 app name is
# per-instance. Passing the wrong name restarts the OTHER business and leaves
# this one running stale code, so the name is echoed loudly below — check it.
#
# Pulls the latest code, installs dependencies, regenerates the Prisma client,
# applies any new database migrations, rebuilds the frontend, and restarts the
# pm2 process — in that order. `set -e` aborts on the first failure, so a
# broken build or a failed migration never ends with the app restarted on bad
# code.
set -euo pipefail

# Run from the repo root no matter where the script is invoked from. This also
# fixes the working directory, which is what `dotenv` reads .env from and what
# pm2 records as the app's cwd — so each instance picks up its OWN .env.
cd "$(dirname "$0")"

# Which pm2 app this checkout owns: first argument, else $PM2_NAME, else posty.
APP_NAME="${1:-${PM2_NAME:-posty}}"
echo "==> Target pm2 app: ${APP_NAME}   (cwd: $(pwd))"

echo "==> [1/6] Pulling latest from GitHub"
# --ff-only: refuse to auto-merge. If this fails, the server has diverging
# local commits or edits to a tracked file — fix that rather than letting a
# deploy create a surprise merge. (.env is gitignored, so your secrets are
# never in the way.)
git pull --ff-only

echo "==> [2/6] Installing dependencies (npm ci)"
npm ci

echo "==> [3/6] Generating Prisma client"
# REQUIRED, not optional. npm 12+ blocks package install scripts by default,
# so `npm ci` no longer triggers Prisma's own client generation, and
# `prisma migrate deploy` does not generate either. Without this step the app
# starts and immediately dies with:
#   "The requested module '@prisma/client' does not provide an export named
#    'PrismaClient'"
# It is cheap (~100ms) and idempotent, so it runs on every deploy.
npm run db:generate

echo "==> [4/6] Applying database migrations"
npm run db:deploy

echo "==> [5/6] Building frontend"
npm run build

echo "==> [6/6] Restarting app (pm2)"
# restart if it's already running; start it the first time.
pm2 restart "$APP_NAME" || pm2 start backend/server.js --name "$APP_NAME"
pm2 save

echo "==> Done. ${APP_NAME} is up to date."
pm2 status "$APP_NAME"
