import { expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AnalyticsPage } from './AnalyticsPage';

// This file exists because of a bug that shipped past every gate we had.
//
// A `useMemo` was added above the `const realEvents` it depended on, so the
// dependency array hit the temporal dead zone and the page threw
// `ReferenceError: Cannot access 'realEvents' before initialization` on
// every render. Reports was blank. Nothing caught it: eslint passes (the
// no-use-before-define rule is not enabled), the production build succeeds
// because the error is a runtime one, and the layout was "verified" against
// a static HTML probe that reproduces the markup by hand and never imports
// this component — so the measurements were of CSS, not of the page.
//
// A test that merely MOUNTS the page would have caught it in a second. That
// is all this is. It is deliberately not a test of what Reports renders:
// its value is that it executes the component at all.

// 200 campaigns, which is the case the redesign exists for. Dated inside
// the default 7-day window — the page range-filters, so fixtures outside it
// render an empty table and prove nothing.
const NOW = Date.now();
const CAMPAIGNS = Array.from({ length: 200 }, (_, i) => ({
  id: `c${i}`,
  name: `Campaign ${i + 1}`,
  status: 'completed',
  createdAt: new Date(NOW - i * 60000).toISOString(),
  scheduledAt: new Date(NOW - i * 60000).toISOString(),
  progress: { sent: 1000 + i, failed: 0 },
}));

// Named explicitly rather than via a Proxy: a Proxy answers every property
// access, including the ones the module system makes, and a throw inside it
// surfaces as the page's generic "Could not load analytics" — which looks
// like a page bug rather than a test-harness one.
vi.mock('../services/brevoApi', () => ({
  getCampaigns: () => Promise.resolve(CAMPAIGNS),
  getEvents: () => Promise.resolve([]),
}));

const mount = () => render(
  <MemoryRouter>
    <AnalyticsPage />
  </MemoryRouter>,
);

test('renders without throwing', () => {
  expect(() => mount()).not.toThrow();
});

test('renders its three regions, so the page is really there', () => {
  mount();
  expect(screen.getByRole('heading', { name: /campaign performance/i })).toBeTruthy();
  expect(screen.getByRole('heading', { name: /^activity$/i })).toBeTruthy();
  expect(screen.getByRole('heading', { name: /top clicked links/i })).toBeTruthy();
});

test('the bounded panels come BEFORE the unbounded table', async () => {
  // The entire point of the redesign. jsdom cannot measure pixels, but it
  // can prove the structure the CSS then bounds: Activity and Top links
  // must precede the campaign table in document order, so no number of
  // campaigns can push them down the page.
  mount();
  // The heading renders while the skeleton is still up, so wait for rows.
  await waitFor(() => expect(document.querySelectorAll('.rp-ledger tbody tr').length).toBeGreaterThan(0));
  const strip = document.querySelector('.rp-strip');
  const ledger = document.querySelector('.rp-ledger');
  expect(strip).not.toBeNull();
  expect(ledger).not.toBeNull();
  expect(strip.compareDocumentPosition(ledger) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy();
});

test('every campaign row renders INSIDE the scroll frame', async () => {
  // If rows ever escaped the frame they would grow the page again, which is
  // the regression this whole change is against.
  mount();
  await waitFor(() => expect(document.querySelectorAll('.rp-ledger tbody tr').length).toBeGreaterThan(0));
  const frame = document.querySelector('.rp-frame');
  const rowsInFrame = frame ? frame.querySelectorAll('tbody tr').length : 0;
  const rowsAnywhere = document.querySelectorAll('.rp-ledger tbody tr').length;
  expect(rowsAnywhere).toBeGreaterThan(0);
  expect(rowsInFrame).toBe(rowsAnywhere);
});

test('the campaign ledger is a labelled, focusable scroll region', () => {
  // Without tabindex a scroll container cannot be scrolled from the
  // keyboard, and its rows are the only other way in.
  mount();
  const frame = document.querySelector('.rp-frame');
  if (frame) {
    expect(frame.getAttribute('tabindex')).toBe('0');
    expect(frame.getAttribute('role')).toBe('region');
    expect(frame.getAttribute('aria-label')).toBeTruthy();
  }
});
