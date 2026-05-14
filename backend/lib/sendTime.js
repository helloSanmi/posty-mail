// Send-time helpers for the per-recipient-timezone feature.
//
// Concept: the admin schedules a campaign for "2026-05-13 09:00 (local to
// each recipient)". The scheduler stores that as a wall-clock local time
// (hour/minute) plus a target date. At fire time, for each contact we
// compute whether their local clock has reached the target. Contacts in
// earlier timezones go first; contacts further west get deferred until
// their local 09:00 catches up.
//
// All math runs in pure JS using Intl. No moment/date-fns dependency.

/**
 * @param {string} iso  ISO datetime as the admin entered in the builder
 *   ("2026-05-13T09:00" without a Z). We interpret the hour/minute/date as
 *   the "local time" we want each recipient to receive at.
 */
export function parseLocalTarget(iso) {
  if (typeof iso !== 'string' || !iso) return null;
  // The builder stores `scheduledAt` as a local-naive ISO string (the
  // value of a datetime-local input). We treat the digits literally, NOT
  // as a UTC instant.
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}

/**
 * Get the current wall-clock time in a given IANA timezone. Returns
 * { year, month, day, hour, minute }. Falls back to UTC if the zone is
 * unknown / unparseable (legacy contacts with no timezone set).
 */
export function nowInZone(zone) {
  const formatter = safeFormatter(zone);
  // formatToParts gives us the components in the target zone without manual
  // offset math. Each part has type + value.
  const parts = formatter.formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

function safeFormatter(zone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    // Unknown timezone string. Fall back to UTC.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
}

/**
 * Compare a contact's now-time (in their zone) against the target. Returns
 * 'now' if the contact has reached or passed the target moment, 'later'
 * otherwise. We compare in lexicographic order of the digit components,
 * which works because each component is fixed-width.
 */
export function isReady(contactNow, target) {
  const c = [contactNow.year, contactNow.month, contactNow.day, contactNow.hour, contactNow.minute];
  const t = [target.year, target.month, target.day, target.hour, target.minute];
  for (let i = 0; i < c.length; i += 1) {
    if (c[i] > t[i]) return 'now';
    if (c[i] < t[i]) return 'later';
  }
  return 'now'; // exact match counts as ready
}

/**
 * Decide whether a campaign with per-timezone scheduling is finished. It's
 * finished when no contact is still in 'later' state. Used by the scheduler
 * to decide if a re-check needs to be scheduled.
 */
export function anyDeferred(contacts, target) {
  for (const contact of contacts) {
    const zone = contact.timezone || 'UTC';
    if (isReady(nowInZone(zone), target) === 'later') return true;
  }
  return false;
}
