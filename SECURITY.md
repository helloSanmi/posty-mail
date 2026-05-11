# Security policy

## Reporting a vulnerability

If you find a security issue in Posty, **please don't open a public GitHub
issue**. Instead email:

> **idowuoluwasanmi@gmail.com**

Include:

- What the bug is and where it lives (file path / route / component is plenty)
- Steps to reproduce, ideally a minimal proof-of-concept
- Your assessment of impact (data leak? auth bypass? remote execution?)

I'll acknowledge within 72 hours and keep you updated on the fix. If the
issue is valid and you'd like credit in the release notes, say so in your
report.

## Scope

In scope:

- Authentication / authorization bypass
- SQL or template injection
- Cross-site scripting in user-supplied HTML (templates, contact data)
- Webhook signature / token bypass
- Credential leaks (envs in logs, secrets in client bundles)
- Anything that lets one user read or modify another user's data

Out of scope:

- Issues requiring physical access to the server
- Reports against `node_modules` dependencies. Open an issue with the
  upstream project instead
- Self-XSS (a user pasting `<script>` into their own template is the user
  attacking themselves; the sanitizer still strips it on save)
- Rate limiting bypasses on dev machines (the dev rate limit is intentionally
  loose; production uses a stricter one)

## Hardening defaults this app already applies

For context. These aren't bugs:

- HTML sanitization on every template save (`backend/lib/sanitize.js`):
  scripts, event handlers, and `javascript:` URIs are stripped; every anchor
  gets `rel="noopener noreferrer"`.
- Subject line stripped of CR/LF (header-injection guard) and capped at 998
  characters per RFC 5321.
- Bcrypt password hashes; JWT auth on every `/api/*` route below the public
  ones.
- Webhook verification: in production the backend refuses to start without
  `BREVO_WEBHOOK_TOKEN` or `BREVO_WEBHOOK_SECRET` configured.
- Rate limiting on `/api` and `/api/webhooks` via `express-rate-limit`.
- `helmet` for response headers.

## Disclosure timeline

- Day 0: report received, acknowledged within 72 hours.
- Day 1–14: fix developed. Reporter kept in the loop on technical questions.
- Day 14–30: patch released.
- Public disclosure (issue / advisory) only after a patched version has been
  available for at least 7 days, unless the reporter prefers earlier.
