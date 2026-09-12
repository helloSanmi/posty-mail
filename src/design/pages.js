import { Preview } from './pages/Preview';

// Registry of pages available in the sandbox. One entry per design as it
// lands, in the agreed order: shell and theme first, then Home, Campaigns,
// Audience, Reports, Email, Builder, and the small pages last.
export const DESIGN_PAGES = [
  { key: 'preview', label: 'Preview', component: Preview },
];
