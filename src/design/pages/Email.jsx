import { useState } from 'react';
import {
  Bold, ChevronDown, Code2, Copy, Eye, Image, Italic, LayoutTemplate, Link2,
  Monitor, Plus, Search, Smartphone, Trash2, Type,
} from 'lucide-react';
import './email.css';

// Email (templates), redesigned.
//
// THE LIST BECOMES A LIST. Today a 280px rail is spent on a <select>
// dropdown, the selected template's subject, and a button. A panel that
// wide exists to show you things, and it was being used to hide them: to
// see what templates you have you must open a dropdown, and to compare two
// you must open it twice. It is now a scannable list with the selected row
// marked, which is what the space was always for.
//
// EDIT AND PREVIEW STOP BEING TABS. You cannot see what you are making
// while you make it — every check costs a round trip through a tab. On a
// wide screen they sit side by side and the preview updates as you type.
// The tabs come back below 1200px, where there genuinely is not room for
// both.
//
// SEVEN FIELDS BECOME THREE. Name, Subject and Preview text identify the
// email and are always visible. Reply-to (two fields) and Category are
// overrides that most templates never set, so they collapse into one
// disclosure. Nothing is removed; the default view stops charging everyone
// for the rare case.

const TEMPLATES = [
  { id: 't1', name: 'September newsletter', subject: 'Three things worth five minutes', used: '3 Sep' },
  { id: 't2', name: 'Welcome email', subject: 'Welcome to Complier, {{firstname}}', used: '28 Aug' },
  { id: 't3', name: 'Autumn offer', subject: '20% off through September', used: '11 Sep' },
  { id: 't4', name: 'Re-engagement', subject: 'Still want to hear from us?', used: '28 Aug' },
  { id: 't5', name: 'Product update', subject: 'What shipped this month', used: null },
];

export function Email() {
  const [selected, setSelected] = useState('t1');
  const [mode, setMode] = useState('visual');
  const [advanced, setAdvanced] = useState(false);
  const [device, setDevice] = useState('desktop');
  const active = TEMPLATES.find((t) => t.id === selected);

  return (
    <div className="em-grid">
      <aside className="em-card em-list">
        <div className="em-card-head">
          <h2>Templates</h2>
          <button type="button" className="em-icon-btn" aria-label="New template" title="New template">
            <Plus size={15} aria-hidden="true" />
          </button>
        </div>

        <span className="em-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" placeholder="Search templates" aria-label="Search templates" />
        </span>

        <ul className="em-list-items">
          {TEMPLATES.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={`em-item${selected === t.id ? ' is-active' : ''}`}
                aria-current={selected === t.id ? 'true' : undefined}
                onClick={() => setSelected(t.id)}
              >
                <span className="em-item-name">{t.name}</span>
                {/* The subject was previously shown only for the selected
                    template, under the dropdown. Showing it per row is what
                    makes the list scannable — two templates called
                    "Newsletter" are told apart by their subject, not their
                    name. */}
                <span className="em-item-subject">{t.subject}</span>
                <span className="em-item-meta">
                  {t.used ? `Last sent ${t.used}` : 'Never sent'}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <button type="button" className="em-gallery">
          <LayoutTemplate size={15} aria-hidden="true" /> Start from a design
        </button>
      </aside>

      <section className="em-card em-editor">
        <div className="em-card-head">
          <h2>{active.name}</h2>
          <div className="em-head-tools">
            <button type="button" className="em-icon-btn" aria-label="Duplicate" title="Duplicate">
              <Copy size={15} aria-hidden="true" />
            </button>
            <button type="button" className="em-icon-btn is-danger" aria-label="Delete" title="Delete">
              <Trash2 size={15} aria-hidden="true" />
            </button>
            <button type="button" className="em-btn em-btn-primary">Save</button>
          </div>
        </div>

        <div className="em-fields">
          <label className="em-field">
            Name
            <input defaultValue={active.name} />
          </label>
          <label className="em-field">
            Subject
            <input defaultValue={active.subject} />
          </label>
          <label className="em-field em-field-wide">
            Preview text
            <input defaultValue="Three things we think are worth five minutes of your time." />
          </label>
        </div>

        {/* Reply-to and Category are overrides most templates never set.
            One disclosure instead of four permanent fields. */}
        <button
          type="button"
          className={`em-disclose${advanced ? ' is-open' : ''}`}
          aria-expanded={advanced}
          onClick={() => setAdvanced((v) => !v)}
        >
          <ChevronDown size={14} aria-hidden="true" />
          Reply-to and category
        </button>
        {advanced && (
          <div className="em-fields em-fields-advanced">
            <label className="em-field">
              Reply-to email
              <input type="email" placeholder="replies@yourdomain.com" />
            </label>
            <label className="em-field">
              Reply-to name
              <input placeholder="Support team" />
            </label>
            <label className="em-field em-field-wide">
              Category
              <select defaultValue="">
                <option value="">No category</option>
                <option value="news">Newsletter</option>
                <option value="product">Product updates</option>
              </select>
            </label>
          </div>
        )}

        <div className="em-body">
          <div className="em-toolbar">
            <div className="em-modes">
              <button
                type="button"
                aria-pressed={mode === 'visual'}
                className={mode === 'visual' ? 'is-active' : ''}
                onClick={() => setMode('visual')}
              >
                <Type size={13} aria-hidden="true" /> Visual
              </button>
              <button
                type="button"
                aria-pressed={mode === 'html'}
                className={mode === 'html' ? 'is-active' : ''}
                onClick={() => setMode('html')}
              >
                <Code2 size={13} aria-hidden="true" /> HTML
              </button>
            </div>
            {mode === 'visual' && (
              <div className="em-tools">
                <button type="button" className="em-icon-btn" aria-label="Bold" title="Bold"><Bold size={14} /></button>
                <button type="button" className="em-icon-btn" aria-label="Italic" title="Italic"><Italic size={14} /></button>
                <button type="button" className="em-icon-btn" aria-label="Link" title="Link"><Link2 size={14} /></button>
                <button type="button" className="em-icon-btn" aria-label="Image" title="Image"><Image size={14} /></button>
              </div>
            )}
          </div>
          <div className={`em-canvas${mode === 'html' ? ' is-code' : ''}`}>
            {mode === 'html' ? (
              <pre className="em-code">{`<table role="presentation" width="100%">
  <tr>
    <td style="padding:24px 12px;">
      <h1>Your monthly roundup is here</h1>
      <p>Hi {{firstname}}, we pulled together the
         three stories that mattered most.</p>
    </td>
  </tr>
</table>`}</pre>
            ) : (
              <div className="em-visual">
                <h3>Your monthly roundup is here</h3>
                <p>
                  Hi <span className="em-tag">{'{{firstname}}'}</span>, we pulled together the three
                  stories that mattered most this month. No filler, no noise.
                </p>
                <span className="em-cta">Browse the full archive</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Side by side, not a tab away. You are making something visual; not
          being able to see it while you make it is the page's real cost. */}
      <aside className="em-card em-preview">
        <div className="em-card-head">
          <h2><Eye size={15} aria-hidden="true" /> Preview</h2>
          <div className="em-devices">
            <button
              type="button"
              aria-label="Desktop preview"
              aria-pressed={device === 'desktop'}
              className={device === 'desktop' ? 'is-active' : ''}
              onClick={() => setDevice('desktop')}
            >
              <Monitor size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Mobile preview"
              aria-pressed={device === 'mobile'}
              className={device === 'mobile' ? 'is-active' : ''}
              onClick={() => setDevice('mobile')}
            >
              <Smartphone size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className={`em-frame is-${device}`}>
          <div className="em-mail">
            <div className="em-mail-head">
              <strong>Complier</strong>
              <span>hello@usecomplier.com</span>
            </div>
            <div className="em-mail-subject">{active.subject}</div>
            <div className="em-mail-preheader">
              Three things we think are worth five minutes of your time.
            </div>
            <div className="em-mail-body">
              <h3>Your monthly roundup is here</h3>
              <p>Hi Alex, we pulled together the three stories that mattered most this month.</p>
              <span className="em-mail-cta">Browse the full archive</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
