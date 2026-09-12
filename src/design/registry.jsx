import { Plus } from 'lucide-react';
import { Shell } from './pages/Shell';
import { Home } from './pages/Home';
import { Campaigns } from './pages/Campaigns';
import { Audience } from './pages/Audience';
import { Reports } from './pages/Reports';
import { Email } from './pages/Email';
import { Builder } from './pages/Builder';
import { CampaignDetail, Admin, Workspaces, Login } from './pages/Small';

// Registry of redesigned pages, in the agreed order: shell and theme first,
// then Home, Campaigns, Audience, Reports, Email, Builder, and the small
// pages last. Each entry wraps its content in the redesigned Shell so it is
// reviewed in the frame it will actually live in.

function Action({ label }) {
  return (
    <button type="button" className="sh-action">
      <Plus size={14} aria-hidden="true" /> {label}
    </button>
  );
}

export const DESIGN_PAGES = [
  {
    key: 'home',
    label: 'Home',
    component: () => (
      <Shell active="Home" title="Home" action={<Action label="New campaign" />}>
        <Home />
      </Shell>
    ),
  },
  {
    key: 'email',
    label: 'Email',
    component: () => (
      <Shell active="Email" title="Email" action={<Action label="New template" />}>
        <Email />
      </Shell>
    ),
  },
  {
    key: 'audience',
    label: 'Audience',
    component: () => (
      <Shell active="Audience" title="Audience" action={<Action label="Add contact" />}>
        <Audience />
      </Shell>
    ),
  },
  {
    key: 'campaigns',
    label: 'Campaigns',
    component: () => (
      <Shell active="Campaigns" title="Campaigns" action={<Action label="New campaign" />}>
        <Campaigns />
      </Shell>
    ),
  },
  {
    key: 'reports',
    label: 'Reports',
    component: () => (
      <Shell active="Reports" title="Reports">
        <Reports />
      </Shell>
    ),
  },
  {
    key: 'builder',
    label: 'Builder',
    component: () => (
      <Shell active="Campaigns" title="New campaign" eyebrow="Campaigns">
        <Builder />
      </Shell>
    ),
  },
  {
    key: 'detail',
    label: 'Campaign',
    component: () => (
      // The campaign's own name is the page title, with "Campaigns" as the
      // eyebrow. The old header carried five identity signals on one line
      // because the topbar could not say where you were.
      <Shell active="Campaigns" title="September newsletter" eyebrow="Campaigns">
        <CampaignDetail />
      </Shell>
    ),
  },
  {
    key: 'admin',
    label: 'Admin',
    component: () => (
      <Shell active="Admin" title="Admin">
        <Admin />
      </Shell>
    ),
  },
  {
    key: 'workspaces',
    label: 'Workspaces',
    component: () => (
      <Shell active="Workspaces" title="Workspaces">
        <Workspaces />
      </Shell>
    ),
  },
  // Login has no shell: it is the one page rendered before there is a
  // workspace to frame.
  { key: 'login', label: 'Login', component: Login },
];
