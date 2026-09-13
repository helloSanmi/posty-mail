import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';

// Where view state lives, and the one rule that decides.
//
// THE RULE. If it says WHERE YOU ARE — a tab, a section, a filter, a sort, a
// page number, the thing you selected — it goes in the URL, because refresh,
// the back button and a link pasted to a colleague should all show the same
// screen. If it says HOW YOU LIKE TO WORK — which columns, which preview
// device, visual or code — it goes in localStorage, because it is per person
// and per device and would be wrong to force onto whoever opened your link.
// If a refresh SHOULD throw it away — a modal, a confirmation, a popover —
// it stays in useState and is not this file's business.
//
// The app had both halves already and no rule: Reports put its time range in
// the URL, the Email page put the selected template in localStorage, and
// eight other places put tabs and filters in useState where a refresh ate
// them. Picking by feel is how you end up with an app that remembers some
// things and not others, which is worse than an app that remembers nothing —
// you cannot predict it, so you stop trusting it.
//
// WHY QUERY PARAMS AND NOT ROUTE SEGMENTS (/admin/roles). Because a tab that
// REPLACES rather than pushes is the behaviour people expect — back should
// leave the page, not walk back through the tabs you looked at — and once a
// tab replaces, a path segment buys nothing a param does not. The sidebar
// highlights on the top-level path and the page title comes from
// pageTitles[path], so both already work. Route segments would be the more
// architecturally pure answer and would cost five new route shapes across
// thirty files; this is the same fix for the person using it.
//
// CALL useViewState ONCE PER ROUTE ELEMENT AND PASS VALUES DOWN. Two
// components writing the same search string in one tick can silently drop a
// write, because react-router resolves a functional setSearchParams against
// the params it last rendered rather than against a write still in flight.
// One owner per URL makes that unreachable rather than rare, and it keeps
// presentational components testable without a router around them.

// The decoder is inferred from the fallback's type, so `{ fallback: 1 }` is
// a number and `{ fallback: false }` is a flag without anyone restating it.
// Declaring the type separately meant a mismatch between the two was silent:
// `{ fallback: 1 }` with no type read ?page=4 as the string "4", and the
// comparison that deletes the default param then never matched.
function typeOf(descriptor) {
  if (descriptor.type) return descriptor.type;
  if (typeof descriptor.fallback === 'number') return 'number';
  if (typeof descriptor.fallback === 'boolean') return 'flag';
  return 'text';
}

// Turn one raw param into something the page can actually render.
// Everything unrecognised collapses to the fallback, so a hand-edited or
// stale URL can never put a value into the page that the page cannot draw.
function decode(raw, descriptor) {
  const { fallback } = descriptor;
  if (raw === null || raw === undefined) return fallback;
  const type = typeOf(descriptor);
  if (type === 'flag') return raw === '1';
  if (type === 'number') {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return fallback;
    // Only the LOW end is clamped. Page 1 always exists; the high end
    // depends on a total this hook has never seen, so clamping it is the
    // caller's job and has to wait for the fetch. Clamp it eagerly and a
    // deep-linked ?page=4 is destroyed before the data it refers to loads.
    return Math.max(descriptor.min ?? 1, parsed);
  }
  const value = descriptor.normalize ? descriptor.normalize(raw) : raw;
  // `allow` is an array of legal values, or absent. Absent means "do not
  // validate" — either because it is free text (a search box), or because
  // the legal values HAVE NOT LOADED YET.
  //
  // That second case is the one that bites. Any param whose vocabulary
  // arrives with a fetch — which group, which segment, which A/B variant —
  // must pass `undefined` until the fetch resolves and the real array
  // afterwards. Hand it an array on the first frame and a legitimate
  // ?tab=variants is rejected and scrubbed out of the URL before the
  // variants have loaded, on every single refresh: the exact bug this file
  // exists to fix, wearing a fix's clothes.
  //
  // An allowlist is also the difference between "this view is wrong" and
  // "this page is white": ?metric=bogus reaches METRIC_DEFINITIONS[bogus]
  // .match() on Reports, which is a TypeError, not an odd-looking table.
  if (descriptor.allow && !descriptor.allow.includes(value)) return fallback;
  return value;
}

// The inverse, where `null` means "this param should not be in the URL".
function encode(value, descriptor) {
  const type = typeOf(descriptor);
  if (type === 'flag') return value ? '1' : null;
  if (type === 'number') {
    const number = Number(value);
    return number === descriptor.fallback ? null : String(number);
  }
  const text = descriptor.normalize ? descriptor.normalize(String(value)) : String(value);
  // alwaysWrite keeps a value in the URL even when it equals the fallback.
  // Settings needs it: its default section is computed from the sections the
  // viewer's ROLE can see, so a bare /settings means Connections to an admin
  // and Subscribe forms to an Editor — two people believing they shared the
  // same page. Everywhere else, dropping the default keeps URLs short.
  if (text === descriptor.fallback && !descriptor.alwaysWrite) return null;
  return text;
}

// useViewState({ q: { fallback: '', debounce: 250 }, page: { fallback: 1 } })
//   -> [{ q, page }, patch, committed]
//
// `values` is a fresh object every render, so read primitives off it in
// effect deps ([view.q, view.page]) and never the object itself.
export function useViewState(spec) {
  const [searchParams, setSearchParams] = useSearchParams();

  // The spec is an object literal at the call site, so its identity changes
  // every render. Read it through a ref inside the callbacks so `patch`
  // stays stable enough to hand to a child or put in an effect dep.
  const specRef = useRef(spec);
  specRef.current = spec;

  // A debounced key keeps a local echo of what has been typed but not yet
  // written. Without it the input is controlled by a value 250ms behind the
  // keystrokes, which drops characters and jumps the caret.
  const [echo, setEcho] = useState({});
  const timers = useRef({});

  // Two readings of the same state, and the difference matters.
  //
  // `values` includes the local echo, so a debounced input stays responsive
  // while its timer runs. `committed` is only ever what the URL says.
  //
  // Anything that FETCHES must read `committed`. Reading `values` instead
  // means a request per keystroke — typing nine characters into the Audience
  // search fired ten of them, because the echo changes on every key and the
  // request params are derived from it. The debounce was quieting the
  // address bar and nothing else, which is the half nobody can see.
  const values = {};
  const committed = {};
  Object.entries(spec).forEach(([key, descriptor]) => {
    const fromUrl = decode(searchParams.get(descriptor.param || key), descriptor);
    committed[key] = fromUrl;
    values[key] = key in echo ? echo[key] : fromUrl;
  });

  // The live params, kept in a ref so a write can build on what the URL says
  // NOW rather than on what it said when the write was scheduled.
  //
  // This is not defensive coding, it is a bug that shipped and was caught by
  // review. The obvious spelling is the functional form,
  // setSearchParams((previous) => ...), but react-router resolves `previous`
  // against the params from the render that produced that setter — not
  // against the current URL. For an immediate write those are the same thing.
  // For a write a debounce has held for 250ms they are not, and the flush
  // rebuilds the whole query string from a snapshot taken before everything
  // that happened in between, silently reverting it.
  //
  // It cost two real regressions:
  //   * typing in the Audience search while on page 2 resets to page 1, and
  //     250ms later page=2 comes back and refetches the old page;
  //   * typing in the Reports search and clicking a column header inside the
  //     debounce window throws the sort away.
  // Both look like the app ignoring you, which is the worst kind of bug to
  // find by hand because the cause is 250ms in the past.
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;

  const write = useCallback((changes, push) => {
    const next = new URLSearchParams(paramsRef.current);
    Object.entries(changes).forEach(([key, value]) => {
      const descriptor = specRef.current[key];
      if (!descriptor) return;
      const name = descriptor.param || key;
      const encoded = encode(value, descriptor);
      if (encoded === null) next.delete(name);
      else next.set(name, encoded);
    });
    setSearchParams(next, { replace: !push });
  }, [setSearchParams]);

  // patch({ status: 'draft', page: 1 }) — one write, one location, one
  // render. Done as two calls it is a real bug: the status lands a render
  // before the page reset, so the list paints page 4 of a filter that only
  // has one page.
  //
  // { push: true } makes one write a real history entry. Used for the
  // Reports drill-down panel and nothing else: Back closing a panel you
  // opened is what people expect; Back undoing a keystroke is not.
  //
  // { immediate: true } cancels a queued debounce and writes now. A Clear
  // button needs it, or a keystroke still in flight lands 250ms after the
  // clear and puts the term back.
  const patch = useCallback((changes, { push = false, immediate = false } = {}) => {
    const now = {};
    Object.entries(changes).forEach(([key, value]) => {
      const descriptor = specRef.current[key];
      const delay = descriptor && descriptor.debounce;
      if (!delay || immediate) {
        if (timers.current[key]) {
          clearTimeout(timers.current[key]);
          timers.current[key] = null;
        }
        now[key] = value;
        return;
      }
      setEcho((previous) => ({ ...previous, [key]: value }));
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => {
        timers.current[key] = null;
        write({ [key]: value }, push);
      }, delay);
    });
    if (Object.keys(now).length) {
      setEcho((previous) => {
        const next = { ...previous };
        Object.keys(now).forEach((key) => { delete next[key]; });
        return next;
      });
      write(now, push);
    }
  }, [write]);

  // Retire an echo the moment the address bar moves — because our own timer
  // flushed it, or because something else spoke (the back button, a link,
  // another patch). The URL wins whenever it speaks; the echo only covers
  // the gap while a timer is still armed.
  useEffect(() => {
    setEcho((previous) => {
      const stale = Object.keys(previous).filter((key) => !timers.current[key]);
      if (!stale.length) return previous;
      const next = { ...previous };
      stale.forEach((key) => { delete next[key]; });
      return next;
    });
  }, [searchParams]);

  // Self-heal, which is the half the existing Reports implementation is
  // missing. ?range=bogus renders a correct 7-day view today while the
  // address bar still says bogus — so the view and the link disagree
  // permanently, and re-sharing propagates the bad param. Anything that
  // decodes to the default (rejected, empty, or merely redundant like
  // ?page=1) is deleted; anything that decodes to a different spelling of
  // itself is rewritten to the spelling the page uses. Converges in one
  // pass, because afterwards the raw param equals its own canonical form.
  useEffect(() => {
    const fixes = {};
    Object.entries(specRef.current).forEach(([key, descriptor]) => {
      if (timers.current[key]) return;
      const raw = searchParams.get(descriptor.param || key);
      if (raw === null) {
        // An absent param is normally correct — that IS how the default is
        // spelled. alwaysWrite is the exception: it exists because the
        // default is computed per viewer, so "absent" does not identify a
        // page, and the whole point is that the URL says which one it meant.
        if (descriptor.alwaysWrite) fixes[key] = descriptor.fallback;
        return;
      }
      const decoded = decode(raw, descriptor);
      if (encode(decoded, descriptor) !== raw) fixes[key] = decoded;
    });
    if (Object.keys(fixes).length) write(fixes, false);
  }, [searchParams, write]);

  // A queued write that lands after unmount is a navigation nobody asked
  // for, on a page they have already left.
  useEffect(() => () => {
    Object.values(timers.current).forEach((timer) => timer && clearTimeout(timer));
  }, []);

  return [values, patch, committed];
}

// --- the other half of the rule -------------------------------------------

// Every persisted key, listed STATICALLY.
//
// The first version of this collected keys as usePreference ran, which is
// wrong in the exact situation the purge exists for: a key is only
// registered once its component has mounted, so signing out in a session
// where you never opened the Email page would leave that page's preferences
// behind for the next person. The purge has to know about keys nobody
// touched this session, so it cannot learn them by being called.
//
// The two `campaign-templates:` / `posty.audit.columns` entries predate
// these hooks and are written directly by their components; they are the
// two that already leak across an account switch today.
export const PERSISTED_KEYS = [
  'posty.email.previewDevice',
  'posty.email.previewClient',
  'posty.email.previewDark',
  'posty.email.editorMode',
  'campaign-templates:selectedId',
  'posty.audit.columns',
  // Written with a raw setItem in OnboardingChecklist rather than through
  // usePreference, so the drift guard in the test suite cannot see it — that
  // guard only scans usePreference call sites. Listed here by hand, and
  // named as the exception it is.
  'posty:onboarding-dismissed',
];

export function usePreference(key, fallback, { allow } = {}) {

  // Read in the LAZY INITIALISER, not in an effect. An effect renders the
  // fallback for one frame first, which is a visible flash of the wrong
  // preview device or the wrong editor mode on every single page load.
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw);
      // Validate on read: a value written by an older build must not be
      // able to reach the render. This is the same reason the URL half has
      // an allowlist.
      if (allow && !allow.includes(parsed)) return fallback;
      return parsed;
    } catch {
      return fallback;
    }
  });

  // Write in the SETTER, not in an effect keyed on the value. An effect runs
  // on mount too, so the first render stamps the fallback over whatever was
  // stored — the trap the Email page already documents in a comment.
  const set = useCallback((next) => {
    setValue((previous) => {
      const resolved = typeof next === 'function' ? next(previous) : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch { /* private mode, quota — a preference is never worth an error */ }
      return resolved;
    });
  }, [key]);

  // A preference changed in one tab should not leave a second open tab
  // rendering a stale value. `storage` only fires in the OTHER tabs, which
  // is exactly the ones that need telling.
  useEffect(() => {
    function onStorage(event) {
      if (event.key !== key) return;
      try {
        const parsed = event.newValue === null ? fallback : JSON.parse(event.newValue);
        setValue(allow && !allow.includes(parsed) ? fallback : parsed);
      } catch { setValue(fallback); }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, set];
}

// Called when a session ends — by an explicit sign-out AND by the 401 path,
// which is the one people forget and the one that fires when a token quietly
// expires on a shared machine.
//
// Deliberately NOT cleared: the theme and the sidebar width. Those are
// properties of the screen someone is sitting at, not of the account, and
// resetting them at every sign-out would be its own small annoyance.
export function clearPersistedViewState() {
  PERSISTED_KEYS.forEach((key) => {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  });
  try { window.sessionStorage.clear(); } catch { /* ignore */ }
}

// --- private view state ---------------------------------------------------

// The audit log's search box and its person filter hold email addresses, IP
// addresses and resource ids. Those belong on the page, and they do NOT
// belong in a URL: the address bar is a different transport with different
// retention — browser history, the Referer header on any outbound click,
// anything that syncs tabs between devices — from the audit table it is
// mirroring. So they persist for the tab, in sessionStorage, which survives
// a refresh and dies with the tab and travels in no link.
export function useSessionState(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  });
  const set = useCallback((next) => {
    setValue((previous) => {
      const resolved = typeof next === 'function' ? next(previous) : next;
      try { window.sessionStorage.setItem(key, JSON.stringify(resolved)); } catch { /* ignore */ }
      return resolved;
    });
  }, [key]);
  return [value, set];
}
