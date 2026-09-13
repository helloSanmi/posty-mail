import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  cleanup, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { GlobalSearch } from './GlobalSearch';

// Global search, judged on the only thing that makes it a search rather than
// a search BOX: does pressing enter on a result open the thing it names?
//
// Four of the five groups used to answer no. A contact result navigated to
// /contacts, a template result to /templates, a segment to /contacts, a draft
// to /campaigns — so you typed a specific person's email, pressed enter, and
// arrived at a list of every contact with the term you had just typed thrown
// away. Only campaigns carried an id. Every one of those destinations was a
// real page that rendered fine, which is why nothing ever flagged it.
//
// Each destination is asserted as a full URL, because the query string IS the
// fix — it only became expressible once tabs, filters and the open template
// moved into the URL.

const h = vi.hoisted(() => ({
  getCampaigns: vi.fn(async () => [{ id: 'c1', name: 'Spring launch', status: 'completed' }]),
  getSavedTemplates: vi.fn(async () => [{ id: 't1', name: 'Spring template', subject: 'Hello spring' }]),
  getSegments: vi.fn(async () => [{ id: 's1', name: 'Spring subscribers' }]),
  getDrafts: vi.fn(async () => [{ id: 'd1', name: 'Spring draft' }]),
  getSavedContacts: vi.fn(async () => ({
    rows: [{ email: 'spring@example.com', firstname: 'Spring', lastname: 'Person' }],
    total: 1,
  })),
}));

vi.mock('../services/brevoApi', () => ({
  getCampaigns: h.getCampaigns,
  getSavedTemplates: h.getSavedTemplates,
  getSegments: h.getSegments,
  getDrafts: h.getDrafts,
  getSavedContacts: h.getSavedContacts,
}));

let areas = ['campaigns', 'templates', 'contacts'];
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ can: (area) => areas.includes(area) }),
}));

function Probe() {
  const location = useLocation();
  return <span data-testid="url">{location.pathname + location.search}</span>;
}

const url = () => screen.getByTestId('url').textContent;

function open() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <GlobalSearch open onClose={() => {}} />
      <Probe />
    </MemoryRouter>,
  );
}

async function search(term) {
  open();
  const input = await screen.findByLabelText('Search');
  fireEvent.change(input, { target: { value: term } });
  return input;
}

afterEach(() => {
  cleanup();
  areas = ['campaigns', 'templates', 'contacts'];
  Object.values(h).forEach((fn) => fn.mockClear());
});

describe('every result opens the thing it names', () => {
  test('a campaign opens that campaign', async () => {
    await search('spring');
    const hit = await screen.findByText('Spring launch');
    fireEvent.click(hit.closest('button'));
    expect(url()).toBe('/campaigns/c1');
  });

  test('a template opens THAT template, not the Email page', async () => {
    // Was '/templates', which showed whatever template happened to be
    // selected last — frequently a different one than the one searched for.
    await search('spring');
    const hit = await screen.findByText('Spring template');
    fireEvent.click(hit.closest('button'));
    expect(url()).toBe('/templates?template=t1');
  });

  test('a contact carries the term through to the list', async () => {
    // Was '/contacts'. There is no per-contact page, so the narrowed list is
    // the destination — but arriving at ALL contacts, having just typed the
    // email, meant typing it again.
    await search('spring');
    const hit = await screen.findByText('spring@example.com');
    fireEvent.click(hit.closest('button'));
    expect(url()).toBe('/contacts?q=spring%40example.com');
  });

  test('a segment opens the Segments tab', async () => {
    // Was '/contacts', which lands on the Contacts tab with the segment
    // nowhere on screen.
    await search('spring');
    const hit = await screen.findByText('Spring subscribers');
    fireEvent.click(hit.closest('button'));
    expect(url()).toBe('/contacts?tab=segments');
  });

  test('a draft lands among the drafts', async () => {
    await search('spring');
    const hit = await screen.findByText('Spring draft');
    fireEvent.click(hit.closest('button'));
    expect(url()).toBe('/campaigns?status=draft');
  });

  test('enter on the keyboard goes to the same place as a click', async () => {
    // The palette is keyboard-first — ⌘K opens it — so the arrow/enter path
    // must not be a second, lesser implementation.
    await search('spring');
    await screen.findByText('Spring launch');
    fireEvent.keyDown(document, { key: 'Enter' });
    await waitFor(() => expect(url()).toBe('/campaigns/c1'));
  });

  test('an email with characters that need escaping survives the round trip', async () => {
    h.getSavedContacts.mockResolvedValueOnce({
      rows: [{ email: 'a+b@example.com', firstname: 'A', lastname: 'B' }],
      total: 1,
    });
    await search('a+b');
    const hit = await screen.findByText('a+b@example.com');
    fireEvent.click(hit.closest('button'));
    // A raw + in a query string decodes to a space, which would search for
    // "a b@example.com" and find nobody.
    expect(url()).toContain('a%2Bb%40example.com');
  });
});

describe('search respects what the role can open', () => {
  test('it does not search areas the role has no access to', async () => {
    // Reads are enforced on the server now, so searching Campaigns as a
    // Viewer would fetch a 403, swallow it, and render an empty group —
    // working by accident. Not asking at all is the honest version.
    areas = ['contacts'];
    await search('spring');
    await waitFor(() => expect(h.getSavedContacts).toHaveBeenCalled());
    expect(h.getCampaigns).not.toHaveBeenCalled();
    expect(h.getSavedTemplates).not.toHaveBeenCalled();
    expect(h.getDrafts).not.toHaveBeenCalled();
  });

  test('and shows no group heading for them either', async () => {
    areas = ['contacts'];
    await search('spring');
    await screen.findByText('spring@example.com');
    expect(screen.queryByText('Campaigns')).toBeNull();
    expect(screen.queryByText('Templates')).toBeNull();
  });

  test('a role with no searchable area is told, not left staring', async () => {
    areas = [];
    await search('spring');
    await waitFor(() => {
      expect(screen.getByText(/No results/)).toBeInTheDocument();
    });
    expect(h.getSavedContacts).not.toHaveBeenCalled();
  });
});
