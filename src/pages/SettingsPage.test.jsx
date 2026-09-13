import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  cleanup, render, screen,
} from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SettingsPage } from './SettingsPage';

// Settings is the hardest of the pages to put in the URL, because the list of
// sections is filtered by the viewer's ROLE. Two things can go wrong, and
// both of them look like a broken app rather than like access control:
//
//   * ?section=connections opened by an Editor, who cannot see Connections,
//     paints an empty pane with nothing highlighted in the nav — a white
//     page reached from a colleague's perfectly well-meant link;
//   * a bare /settings means Connections to an admin and Subscribe forms to
//     an Editor, so two people comparing notes believe they are looking at
//     the same page when they are not.
//
// The first is why the allowlist is the permission-filtered `sections` array
// rather than the full catalogue. The second is why this is the one place in
// the app that writes its default into the URL instead of omitting it.

const can = vi.fn();
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ can }) }));

// The section cards all fetch on mount; none of that is what is under test.
vi.mock('../components/settings/BounceSyncCard', () => ({ BounceSyncCard: () => <div>bounce card</div> }));
vi.mock('../components/settings/DeliverabilityCard', () => ({ DeliverabilityCard: () => <div>deliverability card</div> }));
vi.mock('../components/settings/PreferenceCenterCard', () => ({ PreferenceCenterCard: () => <div>preference card</div> }));
vi.mock('../components/settings/SendingCard', () => ({ SendingCard: () => <div>sending card</div> }));
vi.mock('../components/settings/SubscribeFormsCard', () => ({ SubscribeFormsCard: () => <div>forms card</div> }));
vi.mock('../components/settings/UnsubscribeListCard', () => ({ UnsubscribeListCard: () => <div>unsubscribe card</div> }));
vi.mock('../components/settings/WebhookCard', () => ({ WebhookCard: () => <div>webhook card</div> }));

function Probe() {
  const location = useLocation();
  return <span data-testid="url">{location.pathname + location.search}</span>;
}

const ADMIN = ['connections', 'forms', 'bounces', 'unsubscribes'];
const EDITOR = ['forms', 'bounces'];

function mount(areas, entry = '/settings') {
  can.mockImplementation((area) => areas.includes(area));
  render(
    <MemoryRouter initialEntries={[entry]}>
      <SettingsPage notify={() => {}} />
      <Probe />
    </MemoryRouter>,
  );
}

const url = () => screen.getByTestId('url').textContent;

afterEach(() => { cleanup(); can.mockReset(); });

describe('SettingsPage — which section is open', () => {
  test('a deep link opens the section it names', () => {
    mount(ADMIN, '/settings?section=unsubscribes');
    expect(screen.getByText('unsubscribe card')).toBeInTheDocument();
    expect(screen.queryByText('sending card')).toBeNull();
  });

  test('surviving a refresh is the whole point', () => {
    // A remount at the same URL is what a refresh looks like. Before this,
    // the section was useState and every refresh landed you on the first
    // section your role could see, whichever one you had been editing.
    mount(ADMIN, '/settings?section=forms');
    expect(screen.getByText('forms card')).toBeInTheDocument();
    cleanup();
    mount(ADMIN, '/settings?section=forms');
    expect(screen.getByText('forms card')).toBeInTheDocument();
  });

  test('a section the role cannot see falls back to one it can', () => {
    // The shared-link case. An admin sends "the sender setup is here"; an
    // Editor opens it. They must land somewhere real, not on a blank pane.
    mount(EDITOR, '/settings?section=connections');
    expect(screen.queryByText('sending card')).toBeNull();
    expect(screen.getByText('forms card')).toBeInTheDocument();
  });

  test('and the URL is corrected, so re-sharing does not spread it', () => {
    // Falling back while the address bar still says connections would leave
    // the view and the link permanently disagreeing.
    mount(EDITOR, '/settings?section=connections');
    expect(url()).toBe('/settings?section=forms');
  });

  test('the default section is written into the URL, not left implicit', () => {
    // Because the default is per-role. A bare /settings is Connections to an
    // admin and Subscribe forms to an Editor — the same link, two pages.
    mount(ADMIN, '/settings');
    expect(url()).toBe('/settings?section=connections');
  });

  test('two roles land on different defaults, and each URL says which', () => {
    mount(ADMIN, '/settings');
    const adminUrl = url();
    cleanup();
    mount(EDITOR, '/settings');
    expect(url()).not.toBe(adminUrl);
    expect(url()).toBe('/settings?section=forms');
  });

  test('a role sees only the sections it holds', () => {
    mount(EDITOR, '/settings');
    expect(screen.getByRole('button', { name: /Subscribe forms/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Email behavior/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connections/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Unsubscribes/ })).toBeNull();
  });

  test('nonsense in the param does not render an empty pane', () => {
    mount(ADMIN, '/settings?section=hologram');
    expect(screen.getByText('sending card')).toBeInTheDocument();
    expect(url()).toBe('/settings?section=connections');
  });
});
