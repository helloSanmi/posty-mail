// Guards the fix for the page name appearing up to three times on one
// screen. Every pageTitles entry used to carry a `label` identical to its
// `title`, and AppShell's topbar rendered both — eyebrow "SETTINGS" sitting
// directly above the heading "Settings", with the page's own h2 saying it a
// third time on mobile.
//
// The eyebrow now shows only what a page publishes through
// usePageSectionLabel, so a `label` here is redundant by construction. This
// test fails if one is reintroduced.
// Named .jsx with no JSX in it on purpose: `node --test` collects every
// *.test.js in the repo, so the UI suite uses .jsx to stay out of the
// backend run. See the include glob in vite.config.js.
import { describe, expect, it } from 'vitest';
import { navItems, pageTitles } from './navigation';

describe('pageTitles', () => {
  it('gives every route a title', () => {
    Object.entries(pageTitles).forEach(([path, meta]) => {
      expect(meta.title, `${path} has no title`).toBeTruthy();
    });
  });

  it('carries no label that merely repeats the title', () => {
    Object.entries(pageTitles).forEach(([path, meta]) => {
      if (meta.label === undefined) return;
      expect(
        meta.label,
        `${path} sets label === title, which the topbar would render twice`,
      ).not.toBe(meta.title);
    });
  });

  it('has an entry for every nav destination', () => {
    // A route missing here falls back to pageTitles['/'], which is how the
    // campaign detail page once showed "Home" in the topbar.
    navItems.forEach((item) => {
      expect(pageTitles[item.path], `${item.path} has no topbar title`).toBeTruthy();
    });
  });
});
