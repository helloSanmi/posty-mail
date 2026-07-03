#!/usr/bin/env bash
#
# Posty update + redeploy. Run from the server after pushing to GitHub:
#
#   ./deploy.sh
#
# Pulls the latest code, installs dependencies, applies any new database
# migrations, rebuilds the frontend, and restarts the pm2 process — in that
# order. `set -e` aborts on the first failure, so a broken build or a failed
# migration never ends with the app restarted on bad code.
set -euo pipefail

# Run from the repo root no matter where the script is invoked from.
cd "$(dirname "$0")"

echo "==> [1/5] Pulling latest from GitHub"
# --ff-only: refuse to auto-merge. If this fails, the server has diverging
# local commits or edits to a tracked file — fix that rather than letting a
# deploy create a surprise merge. (.env is gitignored, so your secrets are
# never in the way.)
git pull --ff-only

echo "==> [2/5] Installing dependencies (npm ci)"
npm ci

echo "==> [3/5] Applying database migrations"
npm run db:deploy

echo "==> [4/5] Building frontend"
npm run build

echo "==> [5/5] Restarting app (pm2)"
# restart if it's already running; start it the first time.
pm2 restart posty || pm2 start backend/server.js --name posty
pm2 save

echo "==> Done. Posty is up to date."
pm2 status posty
