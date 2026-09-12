import { useState } from 'react';
import {
  ChevronLeft, ChevronRight, Download, Filter, FolderPlus, Globe2, Pencil,
  Plus, Search, Trash2, Upload, Users, X,
} from 'lucide-react';
import './audience.css';

// Audience, redesigned. The worst page in the audit: 35 buttons, 5
// surfaces, 4 headings, 9 muted paragraphs and 21 explanatory sentences.
//
// THREE TOOLBARS BECAME ONE. Today the page stacks a sub-tab strip, then a
// floating right-aligned row holding Upload and Add contact, then the
// table's own heading with its own action cluster. Three bands of controls
// before a single contact. Add contact is the page's primary action so it
// goes to the topbar like everywhere else; Import joins the table's head,
// beside the thing it imports into.
//
// BULK ACTIONS REPLACE THE HEAD INSTEAD OF JOINING IT. Today selecting
// rows ADDS four controls next to the existing ones, so the busiest moment
// on the busiest page is the one where the most is on screen. Here the
// head swaps for a selection bar: the count, the four things you can do to
// them, and a way out. Nothing is added; one thing is exchanged for
// another.
//
// The per-row Edit and Delete follow Campaigns — revealed on hover and on
// focus-within, permanently visible on touch.

const GROUPS = [
  { name: 'All contacts', count: 2847, all: true },
  { name: 'Newsletter subscribers', count: 1204 },
  { name: 'Beta users', count: 86 },
  { name: 'Customers', count: 940 },
  { name: 'Lapsed', count: 312, disabled: true },
];

const CONTACTS = [
  { name: 'Amara Okafor', email: 'amara.okafor@example.com', region: 'United Kingdom', consent: true },
  { name: 'James Whitfield', email: 'j.whitfield@example.org', region: 'United States', consent: true },
  { name: 'Rita Mensah', email: 'r.mensah@example.com', region: 'Ghana', consent: true },
  { name: '—', email: 'old-address@example.net', region: 'United States', consent: false, bounced: true },
  { name: 'Karin Lindqvist', email: 'k.lindqvist@example.se', region: 'Sweden', consent: false },
  { name: 'Dev Patel', email: 'dev.patel@example.co.uk', region: 'United Kingdom', consent: true },
  { name: 'Sofia Marchetti', email: 's.marchetti@example.it', region: 'Italy', consent: true },
  { name: 'Tomas Nowak', email: 't.nowak@example.pl', region: 'Poland', consent: true },
];

export function Audience() {
  const [tab, setTab] = useState('contacts');
  const [group, setGroup] = useState('All contacts');
  const [selected, setSelected] = useState(() => new Set());

  function toggle(email) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }
  const allSelected = selected.size === CONTACTS.length;

  return (
    <>
      <div className="au-tabs" role="tablist" aria-label="Audience sections">
        {[['contacts', 'Contacts', Users], ['segments', 'Segments', Filter]].map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`au-tab${tab === key ? ' is-active' : ''}`}
            onClick={() => setTab(key)}
          >
            <Icon size={15} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'segments' ? (
        <div className="au-card au-placeholder">Segments is designed separately.</div>
      ) : (
        <div className="au-grid">
          <aside className="au-card au-groups">
            <div className="au-card-head">
              <h2>Groups</h2>
              <button type="button" className="au-icon-btn" aria-label="New group" title="New group">
                <Plus size={15} aria-hidden="true" />
              </button>
            </div>
            <ul className="au-group-list">
              {GROUPS.map((g) => (
                <li key={g.name}>
                  <button
                    type="button"
                    className={`au-group${group === g.name ? ' is-active' : ''}${g.disabled ? ' is-off' : ''}`}
                    aria-current={group === g.name ? 'true' : undefined}
                    onClick={() => setGroup(g.name)}
                  >
                    <span className="au-group-name">{g.name}</span>
                    <span className="au-group-count">{g.count.toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="au-card au-table-card">
            {selected.size > 0 ? (
              // The head is REPLACED, not extended. Today these four
              // controls appear alongside everything already there, so the
              // busiest moment on the busiest page is the one with the most
              // on screen.
              <div className="au-selbar">
                <span className="au-selcount">{selected.size} selected</span>
                <div className="au-selactions">
                  <button type="button" className="au-btn">
                    <FolderPlus size={14} aria-hidden="true" /> Move to group
                  </button>
                  <button type="button" className="au-btn">
                    <Globe2 size={14} aria-hidden="true" /> Set region
                  </button>
                  <button type="button" className="au-btn">
                    <Download size={14} aria-hidden="true" /> Export
                  </button>
                  <button type="button" className="au-btn is-danger">
                    <Trash2 size={14} aria-hidden="true" /> Delete
                  </button>
                </div>
                <button
                  type="button"
                  className="au-icon-btn"
                  onClick={() => setSelected(new Set())}
                  aria-label="Clear selection"
                  title="Clear selection"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="au-card-head">
                <div className="au-card-title">
                  <h2>{group}</h2>
                  <span className="au-count">
                    {(GROUPS.find((g) => g.name === group)?.count || 0).toLocaleString()}
                  </span>
                </div>
                <div className="au-head-tools">
                  <span className="au-search">
                    <Search size={14} aria-hidden="true" />
                    <input type="search" placeholder="Search contacts" aria-label="Search contacts" />
                  </span>
                  <button type="button" className="au-btn">
                    <Upload size={14} aria-hidden="true" /> Import
                  </button>
                </div>
              </div>
            )}

            <table className="au-table">
              <thead>
                <tr>
                  <th className="au-check-cell">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      aria-label="Select all contacts"
                      onChange={() => setSelected(allSelected
                        ? new Set()
                        : new Set(CONTACTS.map((c) => c.email)))}
                    />
                  </th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Region</th>
                  <th>Consent</th>
                  <th><span className="au-sr">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {CONTACTS.map((c) => (
                  <tr
                    key={c.email}
                    className={`au-row${selected.has(c.email) ? ' is-selected' : ''}${c.bounced ? ' is-danger' : ''}`}
                  >
                    <td className="au-check-cell">
                      <input
                        type="checkbox"
                        checked={selected.has(c.email)}
                        onChange={() => toggle(c.email)}
                        aria-label={`Select ${c.email}`}
                      />
                    </td>
                    <td className="au-name">{c.name}</td>
                    <td className="au-email">{c.email}</td>
                    <td className="au-dim">{c.region}</td>
                    <td>
                      {c.consent
                        ? <span className="au-pill is-success">Yes</span>
                        : <span className="au-pill is-muted">No</span>}
                    </td>
                    <td>
                      <span className="au-actions">
                        <button type="button" className="au-icon-btn" aria-label={`Edit ${c.email}`} title="Edit">
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="au-icon-btn is-danger"
                          aria-label={`Delete ${c.email}`}
                          title="Delete"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <nav className="au-pagination" aria-label="Contact pagination">
              <button type="button" className="au-page-btn" disabled aria-label="Previous page">
                <ChevronLeft size={14} aria-hidden="true" /> Prev
              </button>
              <span className="au-page-status">Page 1 of 57</span>
              <button type="button" className="au-page-btn" aria-label="Next page">
                Next <ChevronRight size={14} aria-hidden="true" />
              </button>
            </nav>
          </section>
        </div>
      )}
    </>
  );
}
