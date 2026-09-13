// Shared catalog of access areas and levels for role-based access control.
//
// Both the backend (enforcement) and the frontend (sidebar, Access page) read
// this file, so the vocabulary is defined in exactly one place.
//
// WHAT CHANGED AND WHY. Access used to be per-area on/off, and the server
// only ever gated WRITES for content areas — every signed-in user could GET
// contacts, campaigns, templates and settings whatever their role. That made
// "read" a UI convention rather than a guarantee: the sidebar hid the page
// and the API answered anyway. Most visibly, GET /api/contacts/export — the
// whole workspace as a CSV — was reachable by a Viewer holding only
// analytics, because it is a GET under a rule that gated writes.
//
// Levels are ordinal so every check is one integer comparison.

export const LEVELS = { none: 0, read: 1, write: 2, manage: 3 };
export const LEVEL_NAMES = ['none', 'read', 'write', 'manage'];

export function levelValue(name) {
  return LEVELS[name] ?? 0;
}

// Grantable areas. `levels` is the ladder that area actually offers — there
// is no point showing a Reports role a "write" rung when nothing about
// Reports is writable.
//
// `admin` is deliberately NOT here: user and role administration stays with
// the built-in Admin role and can never be handed to a custom role. That is
// the privilege-escalation lock, and it is enforced in three places — this
// list, the normaliser below, and the roles route's validation.
export const AREAS = [
  {
    key: 'contacts',
    label: 'Audience',
    description: 'Contacts, groups and segments.',
    levels: ['none', 'read', 'write', 'manage'],
    // manage is the rung for things that move data off the platform or
    // cannot be undone: export, bulk delete, bulk update, single delete.
    manageMeans: 'Export, bulk edit and delete',
  },
  {
    key: 'templates',
    label: 'Email',
    description: 'Email templates and their images.',
    levels: ['none', 'read', 'write'],
  },
  {
    key: 'campaigns',
    label: 'Campaigns',
    description: 'Build, schedule and send campaigns.',
    levels: ['none', 'read', 'write', 'manage'],
    // Building a campaign and actually sending it to real people are not
    // the same act, and this is the split people reach for first.
    manageMeans: 'Send, schedule and delete',
  },
  {
    key: 'analytics',
    label: 'Reports',
    description: 'Campaign performance and the event stream.',
    levels: ['none', 'read'],
  },
  {
    key: 'forms',
    label: 'Subscribe forms',
    description: 'The embeddable signup form and its snippet.',
    levels: ['none', 'read'],
  },
  {
    key: 'bounces',
    label: 'Bounce handling',
    description: 'Bounce sync and delivery hygiene.',
    levels: ['none', 'read', 'write'],
  },
  {
    key: 'unsubscribes',
    label: 'Unsubscribes',
    description: 'The suppression list and the preference centre.',
    levels: ['none', 'read', 'write', 'manage'],
    // Putting someone BACK on a list they opted out of is a compliance act,
    // not an edit.
    manageMeans: 'Re-subscribe someone who opted out',
  },
  {
    key: 'connections',
    label: 'Connections',
    description: 'Sender identity, deliverability and the provider webhook.',
    levels: ['none', 'read', 'write'],
  },
];

export const ADMIN_AREA = 'admin';
export const ALWAYS_AREAS = ['dashboard'];
export const GRANTABLE_AREA_KEYS = AREAS.map((area) => area.key);
export const ALL_AREA_KEYS = [...GRANTABLE_AREA_KEYS, ADMIN_AREA];
const AREA_BY_KEY = new Map(AREAS.map((area) => [area.key, area]));

export function areaAllows(areaKey, levelName) {
  const area = AREA_BY_KEY.get(areaKey);
  return Boolean(area && area.levels.includes(levelName));
}

export function topLevelFor(areaKey) {
  const area = AREA_BY_KEY.get(areaKey);
  return area ? area.levels[area.levels.length - 1] : 'none';
}

// Reads that one area implies in another, because a page in the first
// legitimately needs them. The campaign builder resolves groups and segments
// to recipients and lists templates; denying those would break the builder
// for a campaigns role, which is why reads were left open in the first place.
//
// Frozen, and only ever grants READ. No role and no admin can extend it —
// it is code, not data, so there is no path by which a grant here becomes a
// way to widen your own access.
export const IMPLIED_READS = Object.freeze({
  campaigns: Object.freeze(['contacts', 'templates']),
  // The form builder lists groups so a signup can be pointed at one.
  forms: Object.freeze(['contacts']),
  // Reports is a report ABOUT campaigns: the page fetches the campaign list
  // and joins it to the event stream, so every row is named. Without this a
  // Viewer's Reports page loads and shows nothing but ids.
  analytics: Object.freeze(['campaigns']),
});

// Accepts every shape that can arrive — the v1 array still in the database,
// the v2 object, and anything corrupt — and returns one canonical map.
// Deny by default: unknown input becomes no access at all.
export function normalizePermissions(value) {
  const areas = {};

  if (Array.isArray(value)) {
    // v1: ["contacts","templates"]. Each key maps to the TOP rung its area
    // offers, not to "write".
    //
    // This is the decision that makes "existing roles keep working" true
    // rather than nearly true. Mapping v1 `campaigns` to write would
    // silently remove the ability to send from every role that has it, on
    // deploy day, with nobody having asked for that. Top rung means every
    // existing role behaves identically the moment this ships; the new
    // rungs are something an admin opts into afterwards.
    value.forEach((key) => {
      if (key === ADMIN_AREA) return;
      if (key === 'settings') {
        // `settings` was one key covering three things. It fans out.
        ['forms', 'bounces', 'unsubscribes'].forEach((split) => {
          areas[split] = topLevelFor(split);
        });
        return;
      }
      if (!GRANTABLE_AREA_KEYS.includes(key)) return;
      areas[key] = topLevelFor(key);
    });
    return { v: 2, areas };
  }

  if (value && typeof value === 'object' && value.areas && typeof value.areas === 'object') {
    Object.entries(value.areas).forEach(([key, level]) => {
      // `admin` is stripped on read as well as on write, so it cannot enter
      // the map from a crafted request, a hand-edited row, or a restored
      // backup.
      if (key === ADMIN_AREA) return;
      if (!GRANTABLE_AREA_KEYS.includes(key)) return;
      if (typeof level !== 'string' || level === 'none') return;
      if (!areaAllows(key, level)) return;
      areas[key] = level;
    });
    return { v: 2, areas };
  }

  return { v: 2, areas: {} };
}

// Direct grants plus implied reads. Implication can only raise an area to
// `read`, and never above what the area itself offers.
export function effectivePermissions(value) {
  const { areas } = normalizePermissions(value);
  const effective = { ...areas };
  Object.entries(IMPLIED_READS).forEach(([source, targets]) => {
    if (!areas[source]) return;
    targets.forEach((target) => {
      if (!GRANTABLE_AREA_KEYS.includes(target)) return;
      if (levelValue(effective[target]) < LEVELS.read) effective[target] = 'read';
    });
  });
  return effective;
}

// True when `permissions` grants at least `level` on `area`.
export function hasLevel(permissions, area, level = 'read') {
  if (!area || ALWAYS_AREAS.includes(area)) return true;
  if (area === ADMIN_AREA) {
    // Admin is not a level and not grantable; it is held or it is not.
    return Array.isArray(permissions)
      ? permissions.includes(ADMIN_AREA)
      : Boolean(permissions?.areas?.[ADMIN_AREA]) || Boolean(permissions?.[ADMIN_AREA]);
  }
  const effective = permissions && permissions.__effective
    ? permissions.__effective
    : effectivePermissions(permissions);
  return levelValue(effective[area]) >= levelValue(level);
}

// Back-compatible name used across the frontend: "can this role open the
// area at all", which is read or better.
export function hasArea(permissions, area) {
  return hasLevel(permissions, area, 'read');
}

export function hasAnyArea(permissions, areas) {
  if (!Array.isArray(areas) || areas.length === 0) return false;
  return areas.some((area) => hasArea(permissions, area));
}

// Built-in roles seeded into every account. Admin is locked; Editor and
// Viewer are editable presets.
export const BUILT_IN_ROLES = [
  {
    key: 'admin',
    name: 'Admin',
    permissions: ALL_AREA_KEYS,
    locked: true,
  },
  {
    key: 'editor',
    name: 'Editor',
    // The day-to-day job, at the rungs it actually needs. Deliberately NOT
    // manage on contacts — exporting the whole audience is not day-to-day —
    // and no connections at all.
    permissions: {
      v: 2,
      areas: {
        contacts: 'write',
        templates: 'write',
        campaigns: 'manage',
        analytics: 'read',
        forms: 'read',
        bounces: 'read',
        unsubscribes: 'read',
      },
    },
  },
  {
    key: 'viewer',
    name: 'Viewer',
    permissions: { v: 2, areas: { analytics: 'read' } },
  },
];

export const BUILT_IN_ROLE_KEYS = BUILT_IN_ROLES.map((role) => role.key);
