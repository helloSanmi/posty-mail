import {
  BarChart3,
  Filter,
  Inbox,
  LayoutDashboard,
  MailCheck,
  PlugZap,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react';

export const navItems = [
  { id: 'dashboard', path: '/', label: 'Home', icon: LayoutDashboard },
  { id: 'templates', path: '/templates', label: 'Email', icon: MailCheck },
  { id: 'contacts', path: '/contacts', label: 'Audience', icon: Users },
  { id: 'segments', path: '/segments', label: 'Segments', icon: Filter },
  { id: 'campaigns', path: '/campaigns', label: 'Campaigns', icon: Inbox },
  { id: 'sequences', path: '/sequences', label: 'Sequences', icon: Workflow },
  { id: 'analytics', path: '/analytics', label: 'Reports', icon: BarChart3 },
  { id: 'integrations', path: '/settings', label: 'Settings', icon: PlugZap },
  { id: 'admin', path: '/admin', label: 'Admin', icon: ShieldCheck, adminOnly: true },
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
};
