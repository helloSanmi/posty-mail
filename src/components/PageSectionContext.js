import { createContext, useContext, useEffect } from 'react';

// Lets a page tell the topbar which SECTION of itself is open, so the
// eyebrow above the page title carries something the title doesn't already
// say. Before this, `pageTitles` gave every route the same string for
// `title` and `label`, and the topbar rendered both — so the eyebrow read
// "SETTINGS" directly above the heading "Settings".
//
// AppShell owns the state and renders the eyebrow; a page opts in with
// usePageSectionLabel('Connections'). Pages that don't opt in get no
// eyebrow at all, which is the right answer when there is no second level
// to name.
export const PageSectionContext = createContext(null);

// Publish `label` as the current section for as long as the calling
// component is mounted, clearing it on the way out so a page without
// sections never inherits the last page's eyebrow.
export function usePageSectionLabel(label) {
  const setSection = useContext(PageSectionContext);
  useEffect(() => {
    if (!setSection) return undefined;
    setSection(label || null);
    return () => setSection(null);
  }, [setSection, label]);
}
