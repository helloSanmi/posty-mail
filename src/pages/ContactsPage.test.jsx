import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  act, cleanup, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ContactsPage } from './ContactsPage';

// Audience, with its tab, its viewed group and the table's filters all moved
// out of useState and into the URL.
//
// The test that matters most here is not one of the persistence ones — it is
// `an unrelated re-render does not refetch`. Moving the filter up to the page
// means it is now built from `view`, which is a fresh object on every render
// by design. Built without useMemo it gets a new identity every render, and
// ContactsTable memoises its request params on [filter, page] and refetches
// when they change. Every render then causes a fetch, which sets state, which
// causes the next render.
//
// That loop is invisible on screen — the list looks completely normal — and
// it has a second cost that is not invisible at all: each refetch clears the
// row selection, so ticking forty contacts and then opening a dialog silently
// unticks all forty. It is the reason `filter` is memoised on its primitives
// and never on `view`.

const h = vi.hoisted(() => ({
  getSavedContacts: vi.fn(async () => ({
    rows: [
      { email: 'a@example.com', firstname: 'A', region: 'GB' },
      { email: 'b@example.com', firstname: 'B', region: 'GB' },
    ],
    total: 2,
    totalPages: 1,
  })),
  getGroups: vi.fn(async () => [{ id: 'g1', name: 'Group one', count: 2 }]),
}));

vi.mock('../services/brevoApi', () => ({
  getSavedContacts: h.getSavedContacts,
  getGroups: h.getGroups,
  getGroupContacts: vi.fn(async () => []),
  patchGroupMembers: vi.fn(async () => ({})),
  saveContactsLocally: vi.fn(async () => ({})),
  bulkDeleteContacts: vi.fn(async () => ({})),
  bulkUpdateContacts: vi.fn(async () => ({})),
  deleteContact: vi.fn(async () => ({})),
  downloadContactsCsv: vi.fn(async () => ({})),
  updateContact: vi.fn(async () => ({})),
  createGroup: vi.fn(async () => ({})),
  deleteGroup: vi.fn(async () => ({})),
  setGroupDisabled: vi.fn(async () => ({})),
  renameGroup: vi.fn(async () => ({})),
  getSegments: vi.fn(async () => []),
}));

// Export and bulk delete are gated on the manage rung; granting it here keeps
// those controls on screen so the selection assertions have something to read.
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));

function Probe() {
  const location = useLocation();
  return <span data-testid="url">{location.pathname + location.search}</span>;
}

const url = () => screen.getByTestId('url').textContent;

function mount(entry = '/contacts') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ContactsPage notify={() => {}} refreshContacts={() => {}} onParsed={() => {}} />
      <Probe />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  h.getSavedContacts.mockClear();
  h.getGroups.mockClear();
});

describe('ContactsPage — the render loop', () => {
  test('an unrelated re-render does not refetch, and does not drop the selection', async () => {
    mount();
    await waitFor(() => expect(screen.getByText(/Select all 2/)).toBeInTheDocument());
    const atRest = h.getSavedContacts.mock.calls.length;

    fireEvent.click(screen.getByLabelText('Select all visible contacts'));
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeInTheDocument());

    // Open an unrelated dialog. The page re-renders; nothing about the view
    // has changed, so nothing should be refetched and nothing unticked.
    fireEvent.click(screen.getByRole('button', { name: /Add contact/i }));
    await act(async () => {});

    expect(h.getSavedContacts.mock.calls.length).toBe(atRest);
    expect(screen.getByText(/2 selected/)).toBeInTheDocument();
  });

  test('typing does not fire a request per keystroke', async () => {
    // It used to: nine characters, ten fetches. The 250ms debounce was
    // quieting the ADDRESS BAR only, because the request params were derived
    // from the local echo that keeps the input responsive rather than from
    // the committed value. The debounce looked present and did nothing that
    // mattered, which is the half nobody can see.
    mount();
    await waitFor(() => expect(h.getSavedContacts).toHaveBeenCalled());
    const atRest = h.getSavedContacts.mock.calls.length;
    const box = screen.getByPlaceholderText(/search/i);

    const word = 'newsletter';
    for (let i = 1; i <= word.length; i += 1) {
      await act(async () => { fireEvent.change(box, { target: { value: word.slice(0, i) } }); });
    }
    await act(async () => {});

    expect(h.getSavedContacts.mock.calls.length - atRest).toBe(0);
  });

  test('but the box itself keeps up with the keyboard', async () => {
    // The other half. Controlling the input from the committed value instead
    // would leave it 250ms behind and drop characters.
    mount();
    await waitFor(() => expect(h.getSavedContacts).toHaveBeenCalled());
    const box = screen.getByPlaceholderText(/search/i);
    await act(async () => { fireEvent.change(box, { target: { value: 'news' } }); });
    expect(box).toHaveValue('news');
  });

  test('settling at rest makes a bounded number of requests', async () => {
    // A loop would climb without limit. Pinning "not more than a handful"
    // rather than an exact count keeps this from breaking on an unrelated
    // extra fetch, while still failing loudly on a runaway.
    mount();
    await waitFor(() => expect(screen.getByText(/Select all 2/)).toBeInTheDocument());
    await act(async () => {});
    expect(h.getSavedContacts.mock.calls.length).toBeLessThan(4);
  });
});

describe('ContactsPage — what survives a refresh', () => {
  test('the tab does — Segments stays Segments across a remount', async () => {
    mount('/contacts?tab=segments');
    await waitFor(() => expect(url()).toBe('/contacts?tab=segments'));
    // The contacts table belongs to the other tab, so its absence is the
    // evidence that the segments tab is the one on screen.
    expect(screen.queryByLabelText('Select all visible contacts')).toBeNull();

    // A remount at the same URL is what a refresh looks like. Before this,
    // the tab was useState and every refresh landed you back on Contacts.
    cleanup();
    mount('/contacts?tab=segments');
    await waitFor(() => expect(url()).toBe('/contacts?tab=segments'));
    expect(screen.queryByLabelText('Select all visible contacts')).toBeNull();
  });

  test('the search term reaches the request', async () => {
    mount('/contacts?q=hello');
    await waitFor(() => expect(h.getSavedContacts).toHaveBeenCalled());
    const [params] = h.getSavedContacts.mock.calls.at(-1);
    expect(params.search).toBe('hello');
  });

  test('a region is upper-cased into a canonical URL', async () => {
    // normalize runs on read as well as write, so a hand-typed ?region=gb
    // settles to the spelling the page uses instead of the view and the link
    // disagreeing forever.
    mount('/contacts?region=gb');
    await waitFor(() => expect(url()).toBe('/contacts?region=GB'));
  });

  test('nonsense in a validated param is scrubbed rather than rendered', async () => {
    mount('/contacts?consent=maybe');
    await waitFor(() => expect(url()).toBe('/contacts'));
  });

  test('a group id is kept even though its vocabulary loads late', async () => {
    // No allowlist on ids, deliberately: judging on the first frame would
    // scrub a perfectly good ?group= before the groups have arrived.
    mount('/contacts?group=g1');
    await act(async () => {});
    expect(url()).toContain('group=g1');
  });
});

describe('ContactsPage — the destinations global search sends people to', () => {
  // The other half of the search fix. Emitting /contacts?q=… is worthless if
  // the page ignores the param, and the two halves live in different files,
  // so each can be "correct" while the journey is broken.
  test('?q=<email> arrives already narrowed to that person', async () => {
    mount('/contacts?q=spring%40example.com');
    await waitFor(() => expect(h.getSavedContacts).toHaveBeenCalled());
    const [params] = h.getSavedContacts.mock.calls.at(-1);
    expect(params.search).toBe('spring@example.com');
  });

  test('?tab=segments arrives on the Segments tab', async () => {
    mount('/contacts?tab=segments');
    await waitFor(() => expect(url()).toBe('/contacts?tab=segments'));
    expect(screen.queryByLabelText('Select all visible contacts')).toBeNull();
  });
});
