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

const RESULT_LIMIT = 5; // per group

// Map between an entity group and its lucide icon + display label. Kept
// declarative so adding a new entity type later is one line.
const GROUP_DEFS = [
  { key: 'campaigns', label: 'Campaigns', icon: Inbox },
  { key: 'templates', label: 'Templates', icon: MailCheck },
  { key: 'contacts', label: 'Contacts', icon: Users },
  { key: 'segments', label: 'Segments', icon: Filter },
  { key: 'drafts', label: 'Drafts', icon: FileText },
];

export function GlobalSearch({ open, onClose }) {
  const navigate = useNavigate();
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
    Promise.all([
      getCampaigns().catch(() => []),
      getSavedTemplates().catch(() => []),
      getSegments().catch(() => []),
      getDrafts().catch(() => []),
    ]).then(([campaigns, templates, segments, drafts]) => {
      if (cancelled) return;
      setData((prev) => ({
        ...prev, campaigns, templates, segments, drafts,
      }));
    });
    return () => { cancelled = true; };
  }, [open]);

  // Contacts: server-side search, debounced. Skips the call when the
  // query is empty so the palette doesn't accidentally show "all
  // contacts" — that's what the Contacts page is for.
  useEffect(() => {
    if (!open) return undefined;
    const trimmed = query.trim();
    if (!trimmed) {
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
  }, [query, open]);

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
          path: '/templates',
        })),
      contacts: data.contacts
        .slice(0, RESULT_LIMIT)
        .map((c) => ({
          id: `contact-${c.email}`,
          label: c.email,
          subtitle: [c.firstname, c.lastname].filter(Boolean).join(' '),
          path: '/contacts',
        })),
      segments: data.segments
        .filter((s) => includes(s.name))
        .slice(0, RESULT_LIMIT)
        .map((s) => ({
          id: `segment-${s.id}`,
          label: s.name || 'Untitled segment',
          subtitle: '',
          path: '/contacts',
        })),
      drafts: data.drafts
        .filter((d) => includes(d.name))
        .slice(0, RESULT_LIMIT)
        .map((d) => ({
          id: `draft-${d.id}`,
          label: d.name || 'Untitled draft',
          subtitle: '',
          // Resume the draft via the builder, same handler the Drafts
          // panel on the Campaigns page uses.
          path: '/campaigns',
        })),
    };

    return GROUP_DEFS
      .map((def) => ({ ...def, items: rawGroups[def.key] }))
      .filter((group) => group.items.length > 0);
  }, [data, query]);

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
