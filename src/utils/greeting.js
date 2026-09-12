// Time-of-day greeting. Lives here rather than on the dashboard because the
// topbar shows it on every page now — the page name that used to sit there
// was already on screen, lit up in the sidebar.
export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
