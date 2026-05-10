import {
  BarChart3,
  Inbox,
  LayoutDashboard,
  MailCheck,
  PlugZap,
  ShieldCheck,
  Users,
} from 'lucide-react';

export const navItems = [
  { id: 'dashboard', path: '/', label: 'Home', icon: LayoutDashboard },
  { id: 'templates', path: '/templates', label: 'Email', icon: MailCheck },
  { id: 'contacts', path: '/contacts', label: 'Audience', icon: Users },
  { id: 'campaigns', path: '/campaigns', label: 'Campaigns', icon: Inbox },
  { id: 'analytics', path: '/analytics', label: 'Reports', icon: BarChart3 },
  { id: 'integrations', path: '/settings', label: 'Settings', icon: PlugZap },
  { id: 'admin', path: '/admin', label: 'Admin', icon: ShieldCheck, adminOnly: true },
];

export const pageTitles = {
  '/': { title: 'Home', label: 'Home' },
  '/contacts': { title: 'Audience', label: 'Audience' },
  '/templates': { title: 'Email', label: 'Email' },
  '/builder': { title: 'Campaigns', label: 'Campaigns' },
  '/campaigns': { title: 'Campaigns', label: 'Campaigns' },
  '/analytics': { title: 'Reports', label: 'Reports' },
  '/settings': { title: 'Settings', label: 'Settings' },
  '/admin': { title: 'Admin', label: 'Admin' },
};
