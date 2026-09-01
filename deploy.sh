#!/usr/bin/env bash
#
# Posty update + redeploy. Run from the server after pushing to GitHub:
#
#   ./deploy.sh                 # acts on the pm2 app running from this directory
#   ./deploy.sh posty-b         # names the instance explicitly
#   PM2_NAME=posty-b ./deploy.sh
#
# When you run more than one Posty on one box the pm2 app name is per-instance,
# and naming the wrong one used to look exactly like a successful deploy: the
# pull and build landed here, the restart hit the OTHER business, and this
# checkout kept serving stale code from memory behind a green "Done." That is
# now enforced rather than merely documented — see the preflight below, which
# defaults the name to whichever pm2 app actually runs from this directory and
# refuses to restart one that does not.
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

REPO_DIR="$(pwd -P)"

# pm2's own machine-readable dump, queried through node (guaranteed present
# here, and jlist is stable across versions in a way `pm2 describe` text is
# not). Three lookups:
#   cwd-of <name>      the directory that app runs in   ('' if pm2 has no such app)
#   owner-of <dir>     the app running from that dir     ('' if none)
#   started-at <name>  that app's start timestamp in ms  ('0' if unknown)
# The `|| true` keeps a pm2 hiccup from tripping `set -o pipefail`: an empty
# answer means "pm2 does not know", which every caller below handles.
pm2_query() {
  pm2 jlist 2>/dev/null | node -e '
const [mode, arg] = process.argv.slice(1);
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let apps;
  try { apps = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(apps)) return;
  const cwdOf = (app) => app?.pm2_env?.pm_cwd || app?.pm2_env?.cwd || "";
  const byName = () => apps.find((app) => app.name === arg);
  if (mode === "cwd-of") {
    const hit = byName();
    process.stdout.write(hit ? cwdOf(hit) : "");
  } else if (mode === "owner-of") {
    const hit = apps.find((app) => cwdOf(app) === arg);
    process.stdout.write(hit ? hit.name : "");
  } else if (mode === "started-at") {
    process.stdout.write(String(byName()?.pm2_env?.pm_uptime ?? 0));
  }
});
' "$@" || true
}

# Whichever app pm2 already runs from this directory, if any.
OWNER="$(pm2_query owner-of "$REPO_DIR")"

# Which pm2 app this checkout owns: first argument, else $PM2_NAME, else the
# app already running from here. Defaulting to $OWNER is what makes a bare
# `./deploy.sh` correct in every checkout instead of only in posty-mail's.
# "posty" stays the last resort for a first-ever deploy, when pm2 has no
# record of this directory yet.
APP_NAME="${1:-${PM2_NAME:-${OWNER:-posty}}}"
echo "==> Target pm2 app: ${APP_NAME}   (cwd: ${REPO_DIR})"

# No argument, no $PM2_NAME, and pm2 has no app running from here: the name
# above is the hardcoded fallback, not a fact. Fine on a first-ever deploy;
# worth saying out loud on a second instance, where the right move is to pass
# the name once so pm2 records it and every later deploy resolves itself.
if [[ -z "${1:-}" && -z "${PM2_NAME:-}" && -z "$OWNER" ]]; then
  echo "    NOTE: no pm2 app runs from this directory yet, so '${APP_NAME}' is a"
  echo "          default guess. On a second instance, pass the name explicitly."
fi

# Refuse to deploy into one checkout while restarting another's process. This
# runs before the pull and build, so a mis-target costs a second rather than a
# full build followed by a restart of the wrong business.
TARGET_CWD="$(pm2_query cwd-of "$APP_NAME")"
if [[ -n "$TARGET_CWD" && "$TARGET_CWD" != "$REPO_DIR" ]]; then
  echo "ERROR: pm2 app '${APP_NAME}' runs from ${TARGET_CWD}, not ${REPO_DIR}." >&2
  echo "       Restarting it would reload the wrong business and leave this" >&2
  echo "       checkout serving stale code from memory." >&2
  if [[ -n "$OWNER" ]]; then
    echo "       This directory is served by '${OWNER}'. Run: ./deploy.sh ${OWNER}" >&2
  else
    echo "       No pm2 app runs from here yet. Start one with:" >&2
    echo "         pm2 start backend/server.js --name <new-name>" >&2
  fi
  exit 1
fi

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
# Start timestamp before we touch it, so the reload can be proved rather than
# inferred from pm2's exit code.
STARTED_BEFORE="$(pm2_query started-at "$APP_NAME")"

# restart if it's already running; start it the first time.
pm2 restart "$APP_NAME" || pm2 start backend/server.js --name "$APP_NAME"
pm2 save

# A restart that silently no-ops leaves the previous module graph resident:
# new code on disk, clean git status, a green "Done", and an app still
# answering from the old build until somebody notices stale behaviour in the
# UI. pm_uptime moving forward is the proof it actually reloaded.
STARTED_AFTER="$(pm2_query started-at "$APP_NAME")"
if (( ${STARTED_AFTER:-0} <= ${STARTED_BEFORE:-0} )); then
  echo "ERROR: ${APP_NAME} did not restart — it has been up since before this" >&2
  echo "       deploy and is still serving code from memory." >&2
  echo "       Investigate with: pm2 describe ${APP_NAME}" >&2
  exit 1
fi

echo "==> Done. ${APP_NAME} is up to date."
pm2 status "$APP_NAME"
