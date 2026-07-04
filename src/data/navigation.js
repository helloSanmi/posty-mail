import {
  BarChart3,
  Building2,
  Filter,
  Inbox,
  LayoutDashboard,
  MailCheck,
  PlugZap,
  ShieldCheck,
  Users,
  Workflow,
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
    id: 'segments', path: '/segments', label: 'Segments', icon: Filter, permission: 'segments',
  },
  {
    id: 'sequences', path: '/sequences', label: 'Sequences', icon: Workflow, permission: 'sequences',
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

export const pageTitles = {
  '/': { title: 'Home', label: 'Home' },
  '/contacts': { title: 'Audience', label: 'Audience' },
  '/templates': { title: 'Email', label: 'Email' },
  '/segments': { title: 'Segments', label: 'Segments' },
  '/builder': { title: 'Campaigns', label: 'Campaigns' },
  '/campaigns': { title: 'Campaigns', label: 'Campaigns' },
  '/sequences': { title: 'Sequences', label: 'Sequences' },
  '/analytics': { title: 'Reports', label: 'Reports' },
  '/settings': { title: 'Settings', label: 'Settings' },
  '/admin': { title: 'Admin', label: 'Admin' },
  '/workspaces': { title: 'Workspaces', label: 'Workspaces' },
};
