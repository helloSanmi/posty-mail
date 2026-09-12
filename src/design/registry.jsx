import { Plus } from 'lucide-react';
import { Shell } from './pages/Shell';
import { Home } from './pages/Home';
import { Campaigns } from './pages/Campaigns';
import { Audience } from './pages/Audience';
import { Reports } from './pages/Reports';
import { Email } from './pages/Email';

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
];
