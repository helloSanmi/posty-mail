import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act, cleanup, fireEvent, render, screen,
} from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import {
  PERSISTED_KEYS, clearPersistedViewState, usePreference, useSessionState, useViewState,
} from './useViewState';

// The point of this file is not that the hooks store things. It is that they
// store the RIGHT things in the right place, and that the failure modes which
// make a persistence layer worse than no persistence layer cannot happen:
//
//   * a legitimate deep link rewritten away before its vocabulary loads,
//   * a default stamped over a stored preference on mount,
//   * two writes in one tick collapsing to one,
//   * an email address ending up in the address bar,
//   * one account's view state greeting the next person on a shared machine.
//
// Each of those is a test below, and each one describes a bug that would look
// exactly like "it works" from a screenshot.

function Probe() {
  const location = useLocation();
  return <span data-testid="url">{location.pathname + location.search}</span>;
}

const url = () => screen.getByTestId('url').textContent;

afterEach(cleanup);

describe('useViewState — the URL half', () => {
  function Page({ spec, onPatch }) {
    const [view, patch] = useViewState(spec);
    onPatch.current = patch;
    return (
      <>
        <span data-testid="value">{JSON.stringify(view)}</span>
        <Probe />
      </>
    );
  }

  const mount = (spec, initial = '/list') => {
    const ref = { current: null };
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Page spec={spec} onPatch={ref} />
      </MemoryRouter>,
    );
    return ref;
  };

  test('reads the value out of the URL on the first frame', () => {
    // Not in an effect. Resolving in an effect paints the default tab for one
    // frame first, which is a visible flash of the wrong panel on every load.
    mount({ tab: { fallback: 'team', allow: ['team', 'roles'] } }, '/list?tab=roles');
    expect(screen.getByTestId('value')).toHaveTextContent('"tab":"roles"');
  });

  test('drops the param when the value returns to the default', () => {
    const patch = mount({ tab: { fallback: 'team', allow: ['team', 'roles'] } }, '/list?tab=roles');
    act(() => patch.current({ tab: 'team' }));
    expect(url()).toBe('/list');
  });

  test('a value outside the allowlist falls back AND is scrubbed from the URL', () => {
    // Falling back without scrubbing is what Reports does today: the view is
    // right, the address bar still says bogus, and re-sharing the link
    // propagates the bad param forever.
    mount({ tab: { fallback: 'team', allow: ['team', 'roles'] } }, '/list?tab=bogus');
    expect(screen.getByTestId('value')).toHaveTextContent('"tab":"team"');
    expect(url()).toBe('/list');
  });

  test('an absent allowlist holds an unknown value instead of judging it', () => {
    // The async case. A campaign's A/B variants tab, a group id, a segment —
    // the legal values arrive with a fetch, so the caller passes `undefined`
    // until it resolves. Judged on the first frame instead, a legitimate
    // ?tab=variants is rewritten to the default on every refresh, which is
    // the exact bug this file exists to fix, wearing a fix's clothes.
    mount({ tab: { fallback: 'recipients' } }, '/list?tab=variants');
    expect(screen.getByTestId('value')).toHaveTextContent('"tab":"variants"');
    expect(url()).toBe('/list?tab=variants');
  });

  test('and judges it once the vocabulary arrives', () => {
    const spec = { tab: { fallback: 'recipients', allow: ['recipients', 'links'] } };
    mount(spec, '/list?tab=variants');
    expect(screen.getByTestId('value')).toHaveTextContent('"tab":"recipients"');
    expect(url()).toBe('/list');
  });

  test('infers number from the fallback, with no type declaration', () => {
    const patch = mount({ page: { fallback: 1 } }, '/list?page=4');
    expect(screen.getByTestId('value')).toHaveTextContent('"page":4');
    act(() => patch.current({ page: 1 }));
    expect(url()).toBe('/list');
  });

  test('a junk number falls back rather than rendering NaN', () => {
    mount({ page: { fallback: 1 } }, '/list?page=banana');
    expect(screen.getByTestId('value')).toHaveTextContent('"page":1');
  });

  test('does not clamp the high end of a page number', () => {
    // The total is not known until the fetch lands. Clamping eagerly
    // destroys a deep-linked ?page=4 before the data it refers to exists.
    mount({ page: { fallback: 1 } }, '/list?page=400');
    expect(screen.getByTestId('value')).toHaveTextContent('"page":400');
  });

  test('two keys in one patch produce ONE location, not two', () => {
    // Written as two calls, the status lands a render before the page reset,
    // so the list paints page 4 of a filter that only has one page.
    const patch = mount({
      status: { fallback: 'all', allow: ['all', 'draft'] },
      page: { fallback: 1 },
    }, '/list?page=4');
    act(() => patch.current({ status: 'draft', page: 1 }));
    expect(url()).toBe('/list?status=draft');
  });

  test('alwaysWrite stamps the default into a URL that omits it', () => {
    // The case that matters most and the one the first implementation
    // missed: nobody patches anything, they just open /settings. If the
    // default is only written on a change, the bare URL stays bare and
    // still means two different pages to two different roles.
    mount({
      section: { fallback: 'connections', allow: ['connections', 'forms'], alwaysWrite: true },
    }, '/list');
    expect(url()).toBe('/list?section=connections');
  });

  test('alwaysWrite keeps the default in the URL where the default is per-role', () => {
    // /settings means Connections to an admin and Subscribe forms to an
    // Editor. Without this, two people believe they shared the same page.
    const patch = mount({
      section: { fallback: 'connections', allow: ['connections', 'forms'], alwaysWrite: true },
    }, '/list?section=forms');
    act(() => patch.current({ section: 'connections' }));
    expect(url()).toBe('/list?section=connections');
  });

  test('a debounced key echoes locally so typing does not drop characters', () => {
    vi.useFakeTimers();
    try {
      const patch = mount({ q: { fallback: '', debounce: 250 } });
      act(() => patch.current({ q: 'sanmi' }));
      // Visible immediately...
      expect(screen.getByTestId('value')).toHaveTextContent('"q":"sanmi"');
      // ...but not yet a navigation.
      expect(url()).toBe('/list');
      act(() => { vi.advanceTimersByTime(250); });
      expect(url()).toBe('/list?q=sanmi');
    } finally {
      vi.useRealTimers();
    }
  });

  test('immediate cancels a queued debounce, so Clear stays cleared', () => {
    vi.useFakeTimers();
    try {
      const patch = mount({ q: { fallback: '', debounce: 250 } });
      act(() => patch.current({ q: 'typo' }));
      act(() => patch.current({ q: '' }, { immediate: true }));
      act(() => { vi.advanceTimersByTime(500); });
      // Without the cancel, the in-flight keystroke lands after the clear
      // and puts the term back 250ms later.
      expect(url()).toBe('/list');
      expect(screen.getByTestId('value')).toHaveTextContent('"q":""');
    } finally {
      vi.useRealTimers();
    }
  });

  describe('a debounced write builds on the live URL, not a stale snapshot', () => {
    // Both of these failed when this hook first shipped. The debounced write
    // used setSearchParams((previous) => ...), and react-router resolves
    // `previous` against the render that produced the setter — so a write held
    // for 250ms rebuilt the whole query string from before everything that
    // happened in between.
    test('a page reset is not undone by the flush that follows it', () => {
      vi.useFakeTimers();
      const patch = mount(
        { q: { fallback: '', debounce: 250 }, page: { fallback: 1 } },
        '/contacts?q=abc&page=2',
      );
      // What ContactsPage.updateFilter does: reset the page and narrow, in
      // one patch. The reset lands now; the term lands 250ms later.
      act(() => patch.current({ page: 1, q: 'abcd' }));
      act(() => { vi.advanceTimersByTime(300); });
      vi.useRealTimers();
      // Not '?q=abcd&page=2' — the flush must not resurrect the page you were
      // on before you started typing, and refetch it.
      expect(url()).toBe('/contacts?q=abcd');
    });

    test('a write during the debounce window is not clobbered by the flush', () => {
      vi.useFakeTimers();
      const patch = mount(
        { q: { fallback: '', debounce: 250 }, sort: { fallback: 'date', allow: ['date', 'sent'] } },
        '/analytics',
      );
      act(() => patch.current({ q: 'news' }));      // typing (debounced)
      act(() => { vi.advanceTimersByTime(100); });
      act(() => patch.current({ sort: 'sent' }));   // click a column header
      act(() => { vi.advanceTimersByTime(300); });
      vi.useRealTimers();
      // The sort survives the flush. It used to be thrown away by it.
      expect(url()).toContain('sort=sent');
      expect(url()).toContain('q=news');
    });
  });
});

describe('usePreference — the localStorage half', () => {
  beforeEach(() => window.localStorage.clear());

  function Pref({ allow }) {
    const [device, setDevice] = usePreference('posty.test.device', 'desktop', { allow });
    return (
      <button type="button" onClick={() => setDevice('mobile')}>{device}</button>
    );
  }

  test('mounting does NOT stamp the default over a stored choice', () => {
    // The trap. Written as an effect keyed on the value, the first render
    // overwrites storage with the fallback before anyone touches anything —
    // so the preference silently never persists and looks like it does.
    window.localStorage.setItem('posty.test.device', '"mobile"');
    render(<Pref />);
    expect(screen.getByRole('button')).toHaveTextContent('mobile');
    expect(window.localStorage.getItem('posty.test.device')).toBe('"mobile"');
  });

  test('reads on the first frame, with no flash of the default', () => {
    window.localStorage.setItem('posty.test.device', '"mobile"');
    render(<Pref />);
    // If this were read in an effect, the first paint would say desktop.
    expect(screen.getByRole('button')).not.toHaveTextContent('desktop');
  });

  test('a stored value from an older build cannot reach the render', () => {
    window.localStorage.setItem('posty.test.device', '"hologram"');
    render(<Pref allow={['desktop', 'mobile']} />);
    expect(screen.getByRole('button')).toHaveTextContent('desktop');
  });

  test('survives corrupt JSON', () => {
    window.localStorage.setItem('posty.test.device', '{not json');
    render(<Pref />);
    expect(screen.getByRole('button')).toHaveTextContent('desktop');
  });

  test('writing persists', () => {
    render(<Pref />);
    fireEvent.click(screen.getByRole('button'));
    expect(window.localStorage.getItem('posty.test.device')).toBe('"mobile"');
  });
});

describe('useSessionState — what must not reach the address bar', () => {
  beforeEach(() => window.sessionStorage.clear());

  function Audit() {
    const [q, setQ] = useSessionState('posty.test.audit.q', '');
    return (
      <>
        <button type="button" onClick={() => setQ('ops@example.com')}>{q || 'empty'}</button>
        <Probe />
      </>
    );
  }

  test('an email typed into the audit search never enters the URL', () => {
    // The address bar is a different transport with different retention from
    // the audit table it mirrors: browser history, the Referer header on any
    // outbound click, tab sync between devices.
    render(<MemoryRouter initialEntries={['/admin']}><Audit /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button'));
    expect(url()).toBe('/admin');
    expect(url()).not.toContain('ops@example.com');
  });

  test('but it does survive a refresh, which is the whole complaint', () => {
    render(<MemoryRouter initialEntries={['/admin']}><Audit /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button'));
    cleanup();
    // A remount with the same sessionStorage is what a refresh looks like.
    render(<MemoryRouter initialEntries={['/admin']}><Audit /></MemoryRouter>);
    expect(screen.getByRole('button')).toHaveTextContent('ops@example.com');
  });
});

describe('clearPersistedViewState — the shared machine', () => {
  test('clears a preference from a page that was never opened this session', () => {
    // The bug the first version had. Collecting keys as usePreference runs
    // means a key is only known once its component has mounted — so signing
    // out in a session where you never opened the Email page left that
    // page's preferences behind for whoever signed in next. The purge has to
    // know about keys nobody touched, so it cannot learn them by being
    // called. Nothing is rendered in this test, deliberately.
    window.localStorage.setItem('posty.email.previewDevice', '"mobile"');
    window.localStorage.setItem('posty.email.editorMode', '"html"');

    clearPersistedViewState();

    expect(window.localStorage.getItem('posty.email.previewDevice')).toBeNull();
    expect(window.localStorage.getItem('posty.email.editorMode')).toBeNull();
  });

  test('takes the two keys that already leaked across accounts', () => {
    // These predate the hooks and are written directly by their components.
    // Before this change, signing out and in as someone else in the same tab
    // handed the next person the previous user's last-opened template and
    // their audit column choices.
    window.localStorage.setItem('campaign-templates:selectedId', 'custom-99');
    window.localStorage.setItem('posty.audit.columns', '["when"]');

    clearPersistedViewState();

    expect(window.localStorage.getItem('campaign-templates:selectedId')).toBeNull();
    expect(window.localStorage.getItem('posty.audit.columns')).toBeNull();
  });

  test('takes the audit search and filters with it', () => {
    window.sessionStorage.setItem('posty.audit.q', '"ops@example.com"');
    clearPersistedViewState();
    expect(window.sessionStorage.getItem('posty.audit.q')).toBeNull();
  });

  test('every key usePreference is called with is in the static list', () => {
    // The list is hand-maintained, which is the cost of it being static.
    // This is the guard: a new usePreference('posty.x.y', …) added anywhere
    // in src/ that is not also added to PERSISTED_KEYS fails here rather
    // than quietly surviving sign-out.
    const sources = import.meta.glob('../**/*.jsx', { eager: true, query: '?raw', import: 'default' });
    const used = new Set();
    Object.values(sources).forEach((text) => {
      for (const match of String(text).matchAll(/usePreference\(\s*'([^']+)'/g)) {
        used.add(match[1]);
      }
    });
    expect(used.size).toBeGreaterThan(0);
    used.forEach((key) => expect(PERSISTED_KEYS).toContain(key));
  });

  test('but leaves the theme and the sidebar alone', () => {
    // Those are properties of the screen someone is sitting at, not of the
    // account. Resetting them at every sign-out is its own small annoyance.
    window.localStorage.setItem('posty.theme', 'dark');
    window.localStorage.setItem('posty.sidebar.collapsed', 'true');
    clearPersistedViewState();
    expect(window.localStorage.getItem('posty.theme')).toBe('dark');
    expect(window.localStorage.getItem('posty.sidebar.collapsed')).toBe('true');
  });
});
