---
name: Good first issue (maintainer-authored)
about: Template maintainers use when filing starter tasks for new contributors.
title: ''
labels: 'good first issue'
assignees: ''
---

<!--
For maintainers. Fill in the four sections below so the issue is actionable
without the contributor needing to ask "where do I start?" Use the file
pointers + acceptance criteria to make scope unambiguous.
-->

### What

One sentence on the user-visible change.

### Why it matters

One sentence on the impact. "Today users hit X / can't do Y / are confused by Z."

### Where to look

- Primary file(s): `path/to/file.js[x]`
- Related tests (or where to add them): `test/...`
- Any helper already in place that should be reused: `backend/lib/...`

### Acceptance criteria

- [ ] The change is scoped to the files above.
- [ ] `npm run lint` is clean.
- [ ] `npm run test` passes (existing tests + any new ones you add).
- [ ] (UI changes) Manual smoke check on a fresh `npm run dev`.
- [ ] PR description explains the user-visible change in 1-2 sentences.

### Mentor

@helloSanmi will review. Tag in the PR if blocked.
