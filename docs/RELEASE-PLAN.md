# Release plan

Personal-track for upcoming milestones. Not part of public docs.

## Shipped

- **2026-05-10 — v0.1.0** — first public release. Tagged on GitHub.

## Pending

### r/selfhosted launch post — this week

Draft lives in conversation notes. Best window Tue–Thu morning US time.
Reply to every comment for the first 24h.

### awesome-selfhosted PR — **submit on or after 2026-09-10**

`awesome-selfhosted-data` curation policy: *"any software project you are
adding was first released more than 4 months ago"*. v0.1.0 was tagged
2026-05-10, so the earliest valid submission date is **2026-09-10**.

The YAML file is already written and parked locally at
`~/Documents/Dev/awesome-selfhosted-data/software/posty.yml` on the
`add-posty` branch (not pushed — origin still points at upstream).

When the time comes:

1. Fork `awesome-selfhosted/awesome-selfhosted-data` on GitHub if not done
2. `cd ~/Documents/Dev/awesome-selfhosted-data`
3. `git remote set-url origin https://github.com/helloSanmi/awesome-selfhosted-data.git`
4. `git push -u origin add-posty`
5. Open PR against upstream `master`
6. PR body — see drafts in conversation

### Other things to revisit when there's signal

- **Demo deploy** (Fly.io / Render) — only if Reddit feedback indicates
  people would try it but won't self-install.
- **Frontend test coverage** — start adding Vitest tests alongside
  features as they evolve, not in one big batch.
- **Multi-provider sender** — currently Brevo-only. ~150 lines to
  abstract; only worth doing if someone files an issue asking for it.
- **Posty domain / website** — not yet. README + GitHub repo are the
  landing page until there's a reason to invest in a marketing site.

## Versioning

Following [SemVer](https://semver.org/). While 0.x, breaking changes
between minors are allowed and called out in release notes. After 1.0,
breaking changes only on major bumps.
