# Contributing to Posty

Thanks for your interest. This is a small project, so contributions of any
size are welcome. Typo fixes, bug reports, new features, documentation.

## Quick start

```bash
git clone https://github.com/helloSanmi/posty-mail.git
cd posty-mail
npm install
cp .env.example .env

# Spin up Postgres in Docker
npm run docker:db

# Apply schema
npm run db:migrate

# Start frontend + backend together
npm run dev
```

Frontend: http://localhost:5173 · Backend: http://localhost:4010

The first user to sign up at `/login` becomes admin. After that signups are
locked unless you set `ALLOW_OPEN_SIGNUP=true` in `.env`.

You don't need a Brevo account to develop locally. Without `BREVO_API_KEY`
set, every send is a dry-run (logged, not delivered). All UI flows still work.

## What to work on

Look for [issues labelled `good first issue`][gfi]. They're scoped small and
self-contained. If you want to take one, drop a comment so we don't double up.

[gfi]: https://github.com/helloSanmi/posty-mail/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22

## Pull requests

1. Fork, branch from `main`, push, open a PR.
2. Keep PRs focused on one change. If you find an unrelated bug, open a
   second PR.
3. Run `npm test` and `npm run lint` before pushing.
4. Update the README or inline docs if you change behavior.
5. Don't bump the version number. Maintainers do that on release.

The PR template will prompt you for a quick description and a "how I tested
this" section. Both are required, even for trivial changes.

## Code style

- ESLint config lives in `eslint.config.js`. `npm run lint` is the source of truth.
- Backend is plain ESM JavaScript (no TypeScript). The frontend uses `.jsx`.
  Don't migrate either to TypeScript in a single PR. Too disruptive.
- Comments explain *why*, not *what*. If a comment restates what the code
  does, delete it.
- React components live in `src/components/`. Pages in `src/pages/`. Shared
  utilities in `src/utils/`.
- Backend routes in `backend/routes/`, db helpers in `backend/lib/db.js`,
  background jobs in `backend/lib/scheduler.js`.

## Tests

```bash
npm test            # node --test on backend lib + utils
npm run lint        # eslint
```

There's no UI test suite yet. If you're adding something complex on the
frontend, consider a small Playwright or Vitest test alongside it. But
don't let that block you from sending the PR. Better an untested fix than
no fix.

## Database changes

Schema lives in `prisma/schema.prisma`. To add a column:

```bash
# Edit the schema, then:
npx prisma migrate dev --name describes_what_changed
```

Commit the generated migration file. Don't commit Prisma's generated client
(`node_modules/@prisma/client/`. Already gitignored).

If you're seeding data for testing, put the script in `backend/scripts/` and
make it idempotent (safe to re-run).

## Brevo specifics

The transactional API uses `POST /smtp/email`. Webhooks fire to
`/api/webhooks/brevo`. Event tags follow the pattern
`['campaign-suite', 'campaign:<uuid>', 'variant:<id>']` so per-campaign
metrics can fan out from the shared event log.

If you're adding a new event type, update both
`src/utils/brevoEvents.js` (UI classification) and the matching sets in
`backend/routes/campaigns.js` (metrics counting). The two should stay in
lockstep.

## Reporting bugs

Use the **Bug** issue template. Include:

- What you did
- What you expected
- What happened (with logs / screenshots if relevant)
- Your env: OS, Node version, browser

For security issues, **do not** open a public issue. See [SECURITY.md](SECURITY.md).

## Code of conduct

Be kind. Disagree on the work, not the person. Maintainers reserve the right
to lock or close threads that get personal.
