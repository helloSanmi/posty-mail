import {
  BarChart3,
  Building2,
  Inbox,
  LayoutDashboard,
  MailCheck,
  PlugZap,
  ShieldCheck,
  Users,
} from 'lucide-react';

// `permission` (or `anyPermission`) is an access area from
// shared/permissions.js. AppShell hides an item the current role can't reach.
// Items with neither are always visible (Home). superAdminOnly is the
// install-level cross-workspace flag, checked separately.
export const navItems = [
  { id: 'dashboard', path: '/', label: 'Home', icon: LayoutDashboard },
  {
    id: 'templates', path: '/templates', label: 'Email', icon: MailCheck, permission: 'templates',
  },
  {
    id: 'contacts', path: '/contacts', label: 'Audience', icon: Users, permission: 'contacts',
  },
  {
    id: 'campaigns', path: '/campaigns', label: 'Campaigns', icon: Inbox, permission: 'campaigns',
  },
  {
    id: 'analytics', path: '/analytics', label: 'Reports', icon: BarChart3, permission: 'analytics',
  },
  {
    id: 'integrations', path: '/settings', label: 'Settings', icon: PlugZap, anyPermission: ['settings', 'connections'],
  },
  {
    id: 'admin', path: '/admin', label: 'Admin', icon: ShieldCheck, permission: 'admin',
  },
  // Install-level super-admin only — cross-workspace management.
  {
    id: 'workspaces', path: '/workspaces', label: 'Workspaces', icon: Building2, superAdminOnly: true,
  },
];

// The topbar heading per route. There is deliberately no `label` here any
// more: every entry used to carry one identical to `title`, and the topbar
// rendered both, so the eyebrow said "SETTINGS" directly above the heading
// "Settings" (three times over on Settings, which added its own h2 as well).
// A page with a genuine second level publishes it through
// usePageSectionLabel instead, which is the only thing the eyebrow now
// shows.
export const pageTitles = {
  '/': { title: 'Home' },
  '/contacts': { title: 'Audience' },
  '/templates': { title: 'Email' },
  '/builder': { title: 'Campaigns' },
  '/campaigns': { title: 'Campaigns' },
  '/analytics': { title: 'Reports' },
  '/settings': { title: 'Settings' },
  '/admin': { title: 'Admin' },
  '/workspaces': { title: 'Workspaces' },
};
