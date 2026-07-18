// Shared catalog of access "areas" for role-based access control (RBAC).
//
// Both the backend (enforcement) and the frontend (sidebar nav + the Roles
// admin UI) import this file, so the set of grantable areas is defined in
// exactly ONE place. Add a new page/area here and both sides pick it up.
//
// Access is per-area on/off: a role either can or can't use an area. There
// is deliberately no view-vs-edit split — that keeps the model simple and
// predictable ("can this role touch Campaigns at all?").

// Grantable areas — an admin can toggle each of these on any custom role.
// `admin` is intentionally NOT in this list: full user + role
// administration (and the audit log) is reserved to the built-in Admin
// role and can never be handed to a custom role. That avoids a
// privilege-escalation footgun where a non-admin role could grant itself
// more power.
export const AREAS = [
  { key: 'contacts', label: 'Audience', description: 'View and manage contacts, groups, and segments.' },
  { key: 'templates', label: 'Email', description: 'Create and edit email templates.' },
  { key: 'campaigns', label: 'Campaigns', description: 'Build, schedule, and send campaigns.' },
  { key: 'analytics', label: 'Reports', description: 'View campaign performance and analytics.' },
  { key: 'settings', label: 'Settings', description: 'Subscribe forms, bounce handling, and unsubscribes.' },
  { key: 'connections', label: 'Connections', description: 'Sender identity, deliverability, and the provider webhook.' },
];

// The privileged area only the built-in Admin role holds: user management,
// role management, and the audit log.
export const ADMIN_AREA = 'admin';

// Areas every signed-in user can always reach, regardless of role (the Home
// dashboard). Never gated.
export const ALWAYS_AREAS = ['dashboard'];

export const GRANTABLE_AREA_KEYS = AREAS.map((area) => area.key);
export const ALL_AREA_KEYS = [...GRANTABLE_AREA_KEYS, ADMIN_AREA];

// Built-in roles seeded into every account. `admin` is locked (full access,
// can't be edited or deleted). `editor` and `viewer` are editable presets an
// admin can tune or use as-is; they can't be deleted (they anchor the
// account) but their permission sets can change.
export const BUILT_IN_ROLES = [
  { key: 'admin', name: 'Admin', permissions: ALL_AREA_KEYS, locked: true },
  {
    key: 'editor',
    name: 'Editor',
    // Everything an editor needs to do the day-to-day work — but not the
    // account-level provider Connections.
    permissions: GRANTABLE_AREA_KEYS.filter((key) => key !== 'connections'),
  },
  { key: 'viewer', name: 'Viewer', permissions: ['analytics'] },
];

export const BUILT_IN_ROLE_KEYS = BUILT_IN_ROLES.map((role) => role.key);

// True if `permissions` (an array of area keys) grants `area`. Always-on
// areas (dashboard) return true regardless.
export function hasArea(permissions, area) {
  if (!area || ALWAYS_AREAS.includes(area)) return true;
  return Array.isArray(permissions) && permissions.includes(area);
}

// True if `permissions` grants any of `areas`. Used by nav items that a
// user should see if they can reach EITHER of two areas (e.g. Settings is
// visible with `settings` OR `connections`).
export function hasAnyArea(permissions, areas) {
  return areas.some((area) => hasArea(permissions, area));
}
