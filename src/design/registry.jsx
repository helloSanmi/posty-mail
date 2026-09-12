import { Plus } from 'lucide-react';
import { Shell } from './pages/Shell';
import { Home } from './pages/Home';
import { PreviewContent } from './pages/Preview';

// Registry of redesigned pages, in the agreed order: shell and theme first,
// then Home, Campaigns, Audience, Reports, Email, Builder, and the small
// pages last. Each entry wraps its content in the redesigned Shell so it is
// reviewed in the frame it will actually live in.

function NewCampaign() {
  return (
    <button type="button" className="sh-action">
      <Plus size={14} aria-hidden="true" /> New campaign
    </button>
  );
}

export const DESIGN_PAGES = [
  {
    key: 'home',
    label: 'Home',
    component: () => (
      <Shell active="Home" title="Home" action={<NewCampaign />}>
        <Home />
      </Shell>
    ),
  },
  {
    key: 'campaigns',
    label: 'Campaigns',
    component: () => (
      <Shell active="Campaigns" title="Campaigns" eyebrow="All campaigns">
        <PreviewContent />
      </Shell>
    ),
  },
];
