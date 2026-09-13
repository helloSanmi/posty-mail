// A role's key is a slug the server minted from its display name:
// "Campaign Ops" becomes `campaign-ops`. Turning it back into words is a
// presentation detail, not a lookup — the real display name lives on
// /api/roles, which only an admin can read, and the controls that show a
// role (the account menu, the profile page) are on screen for everybody.
//
// Shared rather than copied, so the topbar and the profile page can never
// disagree about what your role is called.
export function prettyRole(key) {
  if (!key) return '';
  return String(key)
    .split('-')
    .filter(Boolean)
    .join(' ')
    .replace(/^./, (character) => character.toUpperCase());
}
