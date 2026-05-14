# Posty roadmap

Four phases. Order by ratio of impact to risk: trust + funnel first, then
polish, then new recipient-facing surface area, then architectural bets that
unlock the next 10x of users.

Each item links back to the original ranking (numbered 1-16) for traceability.

---

## Phase 1 — Trust & funnel

Small, self-contained, no schema changes. Goal: someone landing on the repo
or installing for the first time gets fewer "did I do this right?" moments.

- **Pre-send checklist** (#7). Subject length / all-caps, missing unsubscribe
  merge tag, missing plain-text, > 102KB HTML (Gmail clipping), no link or
  too-many-links, image-only campaigns, broken merge tags. Surfaces in the
  builder and in test-send responses.
- **Spam-score preview** (#9). Rules-based lint: spammy words, link density,
  punctuation patterns. Bundled with the pre-send checks.
- **Deliverability checker** (#6). Resolve SPF / DKIM / DMARC for the sender
  domain. Show pass/warn/fail with the exact DNS record to paste.
- **One-click deploy buttons** (#13). Render / Railway / Coolify badges in
  the README. Goal: install in under 2 minutes.
- **README GIF / screenshot refresh** (#15). Short loop showing the builder
  and a send. Replaces the static dashboard shot at the top.
- **Good-first-issue scaffolding** (#16). Issue template + 10 starter
  issues with file pointers and acceptance criteria.

Shipping order: pre-send checks → deliverability → README polish → issue
scaffolding.

---

## Phase 2 — UX polish

Builds on existing scaffolding. Light schema additions only.

- **Inbox preview** (#8). Render the template in Gmail / Outlook / Apple
  Mail / mobile-sized iframes. Bonus: dark-mode toggle.
- **First-run onboarding wizard** (#10). A dashboard checklist that walks
  through: configure sender → import contacts → send a test → schedule first
  campaign. Persists state in `Setting`.
- **Finish dynamic segments** (#3). `Segment` model and `getSegments` already
  exist in scaffolding. Add the rules engine, the UI to compose rules, the
  preview pane showing matched contacts, and wire into the recipient picker.
- **Public demo instance** (#14). Sandboxed `demo.posty.dev` with a fake
  Brevo (dry-run mode) and hourly DB reset cron. Visitors get a usable instance
  without installing.

---

## Phase 3 — Recipient experience

New models, new surface area. Each item meaningfully changes what the
recipient sees or how a list grows.

- **Preference center** (#11). `/unsubscribe` becomes a category picker
  rather than all-or-nothing. New `ContactPreferences` table, per-category
  consent on each Contact. Templates can carry a category tag and respect it
  at send time.
- **Subscribe-form widget** (#4). `<script src=".../posty-form.js">` snippet
  that drops onto any site. New `/api/public/subscribe` endpoint, rate-limited
  by IP + form id. Optional double-opt-in flow.
- **Send-time per timezone** (#12). Schedule "9am local time" instead of "9am
  UTC". New `timezone` field on Contact (filled via geo-IP or a profile-page
  setting). Scheduler fans out one cron entry per timezone bucket.
- **Block-based editor v1** (#1). Replace the raw-HTML textarea with a small
  block library: heading, paragraph, image, button, divider, spacer. Compiles
  to the same HTML that goes through `sanitizeEmailHtml`. Keep the raw-HTML
  mode as an escape hatch.

---

## Phase 4 — Architectural bets

Biggest payoff per unit of risk; do these once the surrounding product is
stable so the refactor lands on solid ground.

- **Provider abstraction** (#5). Refactor `backend/lib/brevoClient.js` into
  an `EmailProvider` interface. Ship `BrevoProvider`, then `MailgunProvider`,
  `PostmarkProvider`, `SESProvider`. Selection via an env var or the Settings
  page. Tag-scoping (Phase 0 work) generalizes; everything else stays the
  same.
- **Drip sequences / autoresponders** (#2). Multi-step campaigns triggered
  by "added to group X" or "clicked link Y in campaign Z." New `Sequence`
  and `SequenceStep` models, a step-runner that subscribes to events, and a
  builder UI for the step graph. Reuses the existing `runCampaign` send path
  for each step.
