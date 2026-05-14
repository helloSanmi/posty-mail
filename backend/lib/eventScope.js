// Tells whether a Brevo event payload belongs to a message that Posty sent.
//
// Brevo's webhook fires for the entire account, so without scoping we'd ingest
// events from every other system using the same Brevo key (other apps, the
// Brevo UI, transactional bots, etc.) and surface them in our reports. Same
// risk for the catch-up sync: it pulls account-wide history.
//
// Strategy: every send Posty makes is tagged. We recognize the tag on the way
// in and drop anything that lacks it.

// Tags Posty puts on outbound mail. Add new aliases here when the project is
// renamed again rather than scattering string literals across the codebase.
//   - 'posty'           current
//   - 'campaign-suite'  legacy, kept so events from before the rename still match
//   - 'campaign-suite-test'  test-send variant of the legacy tag
const POSTY_TAGS = new Set(['posty', 'campaign-suite', 'campaign-suite-test']);

// Tag prefixes Posty adds. campaign:<id> and variant:<id> are unique enough
// to count as ours, and they're useful when the bare tag is dropped by a
// Brevo replay or partial payload.
const POSTY_TAG_PREFIXES = ['campaign:', 'variant:'];

// Pull tags out of whatever shape Brevo sent. Webhooks usually deliver a real
// array under `tags`. The /smtp/statistics/events API sometimes hands back a
// JSON-encoded string or a comma-separated string under `tag`. Sync code
// normalizes those into `tags`, but accept both just in case.
function readTags(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.tags)) return payload.tags;
  const raw = payload.tag;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to comma-split below
    }
    return raw.split(',').map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

export function isPostyEvent(payload) {
  const tags = readTags(payload);
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    if (POSTY_TAGS.has(tag)) return true;
    for (const prefix of POSTY_TAG_PREFIXES) {
      if (tag.startsWith(prefix)) return true;
    }
  }
  return false;
}

// Exposed for tests and the purge script.
export { POSTY_TAGS, POSTY_TAG_PREFIXES };
