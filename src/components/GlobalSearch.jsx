// Command-palette style global search. Triggered by Cmd/Ctrl+K (handled
// in AppShell) or the topbar search button. Searches across the entity
// types an admin actually navigates between:
//   - Campaigns (by name)
//   - Templates (by name + subject)
//   - Contacts (by email + name)
//   - Segments / Sequences / Drafts (by name)
//
// Data fetch strategy:
//   - On open, fetch every small entity list once (campaigns, templates,
//     segments, sequences, drafts). These are < few hundred each in
//     practice and cheap. Filter client-side.
//   - Contacts can be large, so we don't pre-fetch them. Instead we hit
//     the existing /api/contacts?search= endpoint, debounced as the user
//     types — same path the contacts table uses.
//
// EVERY RESULT OPENS THE THING IT NAMES. Four of the five groups used to
// navigate to a bare page path — a contact result went to /contacts, a
// template result to /templates, a segment to /contacts, a draft to
// /campaigns — so searching for one specific thing and pressing enter put
// you on a list of everything, with the term you had just typed thrown
// away. Only campaigns carried an id. Now that tabs, filters and the
// selected template all live in the URL, each result can address its own
// destination, which is the difference between a search box and a search.
//
// Keyboard nav (arrow up/down, enter) walks the flattened result list.
// Esc or clicking the backdrop closes the palette. Rendered into
// document.body via createPortal so it escapes any parent's overflow.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  FileText,
  Filter,
  Inbox,
  MailCheck,
  Search,
  Users,
  X,
} from 'lucide-react';
import {
  getCampaigns,
  getDrafts,
  getSavedContacts,
  getSavedTemplates,
  getSegments,
} from '../services/brevoApi';
import { useAuth } from '../auth/AuthContext';

const RESULT_LIMIT = 5; // per group

// Map between an entity group and its lucide icon + display label. Kept
// declarative so adding a new entity type later is one line.
// `area` is the access area a group belongs to. Reads are enforced on the
// server now, so searching an area the role cannot open would fetch a 403,
// swallow it, and show nothing — working by accident. Asking first means no
// pointless request, and no group heading that can only ever be empty.
const GROUP_DEFS = [
  { key: 'campaigns', label: 'Campaigns', icon: Inbox, area: 'campaigns' },
  { key: 'templates', label: 'Templates', icon: MailCheck, area: 'templates' },
  { key: 'contacts', label: 'Contacts', icon: Users, area: 'contacts' },
  { key: 'segments', label: 'Segments', icon: Filter, area: 'contacts' },
  { key: 'drafts', label: 'Drafts', icon: FileText, area: 'campaigns' },
];

export function GlobalSearch({ open, onClose }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  // Keyed on a signature of the ANSWERS, not on the identity of `can`.
  //
  // This distinction is load-bearing. The fetch effects below depend on
  // allowedKeys, so if its identity changed every render they would refetch
  // every render, each fetch setting state and causing the next render —
  // the palette would spin forever the moment it opened. `can` happens to be
  // stable today because AuthContext builds it inside a useMemo, but that is
  // a property of a different file that nothing forces to stay true, and
  // "works as long as nobody touches AuthContext" is not a guarantee.
  //
  // Five cheap calls per render buys independence from that. The signature is
  // a string of 1s and 0s, so the memo recomputes exactly when the answers
  // change and never because a function was rebuilt.
  const permissionSignature = GROUP_DEFS.map((def) => (can(def.area) ? '1' : '0')).join('');
  const allowedKeys = useMemo(
    () => new Set(GROUP_DEFS.filter((def) => can(def.area)).map((def) => def.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionSignature],
  );
  const allowed = useMemo(
    () => GROUP_DEFS.filter((def) => allowedKeys.has(def.key)),
    [allowedKeys],
  );
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [data, setData] = useState({
    campaigns: [], templates: [], contacts: [], segments: [], drafts: [],
  });
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset state every time the palette opens. Avoids showing yesterday's
  // query when reopened with stale state from a previous mount.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    // requestAnimationFrame so the input is in the DOM before focus().
    const handle = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(handle);
  }, [open]);

  // Pre-fetch small entity lists on open. Contacts intentionally excluded
  // — fetched server-side as the query changes, so we don't pull thousands
  // of rows we'll never look at.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const none = () => Promise.resolve([]);
    Promise.all([
      allowedKeys.has('campaigns') ? getCampaigns().catch(() => []) : none(),
      allowedKeys.has('templates') ? getSavedTemplates().catch(() => []) : none(),
      allowedKeys.has('segments') ? getSegments().catch(() => []) : none(),
      allowedKeys.has('drafts') ? getDrafts().catch(() => []) : none(),
    ]).then(([campaigns, templates, segments, drafts]) => {
      if (cancelled) return;
      setData((prev) => ({
        ...prev, campaigns, templates, segments, drafts,
      }));
    });
    return () => { cancelled = true; };
  }, [open, allowedKeys]);

  // Contacts: server-side search, debounced. Skips the call when the
  // query is empty so the palette doesn't accidentally show "all
  // contacts" — that's what the Contacts page is for.
  useEffect(() => {
    if (!open) return undefined;
    const trimmed = query.trim();
    if (!trimmed || !allowedKeys.has('contacts')) {
      setData((prev) => ({ ...prev, contacts: [] }));
      return undefined;
    }
    const handle = setTimeout(() => {
      getSavedContacts({ search: trimmed, page: 1, pageSize: RESULT_LIMIT })
        .then((result) => {
          // /api/contacts can return either { rows, total, ... } when
          // paginated or a plain array when unfiltered. Handle both.
          const rows = Array.isArray(result) ? result : (result.rows || []);
          setData((prev) => ({ ...prev, contacts: rows }));
        })
        .catch(() => setData((prev) => ({ ...prev, contacts: [] })));
    }, 180);
    return () => clearTimeout(handle);
  }, [query, open, allowedKeys]);

  // Build the grouped + filtered result list. Each entity type defines
  // its own matchers + how a row should render — keeps the JSX below
  // generic over groups.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const includes = (value) => String(value || '').toLowerCase().includes(q);

    const rawGroups = {
      campaigns: data.campaigns
        .filter((c) => includes(c.name))
        .slice(0, RESULT_LIMIT)
        .map((c) => ({
          id: `campaign-${c.id}`,
          label: c.name || 'Untitled campaign',
          subtitle: c.status || '',
          path: `/campaigns/${c.id}`,
        })),
      templates: data.templates
        .filter((t) => includes(t.name) || includes(t.subject))
        .slice(0, RESULT_LIMIT)
        .map((t) => ({
          id: `template-${t.id}`,
          label: t.name || 'Untitled template',
          subtitle: t.subject || '',
          // Opens THAT template, not the Email page with whatever was last
          // selected still loaded.
          path: `/templates?template=${encodeURIComponent(t.id)}`,
        })),
      contacts: data.contacts
        .slice(0, RESULT_LIMIT)
        .map((c) => ({
          id: `contact-${c.email}`,
          label: c.email,
          subtitle: [c.firstname, c.lastname].filter(Boolean).join(' '),
          // Carries the term through, so the list arrives already narrowed
          // to the person you searched for instead of showing all of them
          // and making you type it a second time. There is no per-contact
          // page to land on, so the filtered list IS the destination.
          path: `/contacts?q=${encodeURIComponent(c.email)}`,
        })),
      segments: data.segments
        .filter((s) => includes(s.name))
        .slice(0, RESULT_LIMIT)
        .map((s) => ({
          id: `segment-${s.id}`,
          label: s.name || 'Untitled segment',
          subtitle: '',
          // Segments live behind Audience's second tab, so a bare /contacts
          // landed on the Contacts tab with the segment nowhere in sight.
          path: '/contacts?tab=segments',
        })),
      drafts: data.drafts
        .filter((d) => includes(d.name))
        .slice(0, RESULT_LIMIT)
        .map((d) => ({
          id: `draft-${d.id}`,
          label: d.name || 'Untitled draft',
          subtitle: '',
          // The comment here used to promise it resumed the draft in the
          // builder; the path was '/campaigns'. Drafts are reached through
          // the Draft filter on the campaigns list, which is addressable
          // now, so this at least lands among the drafts.
          path: '/campaigns?status=draft',
        })),
    };

    return allowed
      .map((def) => ({ ...def, items: rawGroups[def.key] }))
      .filter((group) => group.items.length > 0);
  }, [data, query, allowed]);

  // Flat list of items for keyboard navigation. Reset active index
  // whenever the query changes so we don't end up highlighted on a
  // row that disappeared.
  const flatItems = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups],
  );
  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(flatItems.length - 1, 0)));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === 'Enter') {
        const item = flatItems[activeIndex];
        if (item) {
          event.preventDefault();
          navigate(item.path);
          onClose();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, flatItems, activeIndex, navigate, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="global-search-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="global-search-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="global-search-input-row">
          <Search size={16} aria-hidden="true" className="global-search-icon" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search campaigns, templates, contacts…"
            aria-label="Search"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="global-search-close"
            onClick={onClose}
            aria-label="Close search"
            title="Close (Esc)"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <div className="global-search-results">
          {!query.trim() ? (
            <p className="global-search-hint muted">
              Start typing to search across campaigns, templates, contacts,
              segments, and drafts.
            </p>
          ) : groups.length === 0 ? (
            <p className="empty-state compact">
              No results for &ldquo;{query}&rdquo;.
            </p>
          ) : (
            groups.map((group) => {
              const Icon = group.icon;
              return (
                <div key={group.key} className="global-search-group">
                  <div className="global-search-group-head">
                    <Icon size={12} aria-hidden="true" />
                    <span>{group.label}</span>
                  </div>
                  {group.items.map((item) => {
                    const flatIndex = flatItems.findIndex((x) => x.id === item.id);
                    const isActive = flatIndex === activeIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`global-search-result${isActive ? ' is-active' : ''}`}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        onClick={() => {
                          navigate(item.path);
                          onClose();
                        }}
                      >
                        <span className="global-search-result-label">{item.label}</span>
                        {item.subtitle && (
                          <span className="global-search-result-subtitle">
                            {item.subtitle}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="global-search-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
