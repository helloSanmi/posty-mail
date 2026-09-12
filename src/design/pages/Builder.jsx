import { useState } from 'react';
import {
  Check, ChevronDown, Eye, Send, Users,
} from 'lucide-react';
import './builder.css';

// Builder, redesigned. The largest page in the app, and the one with the
// least structure: eight direct children in a single evenly-spaced flex
// column, no h1, three same-weight headings competing, boxes nested three
// deep, and three hairline rules falling within about 100px of each other.
//
// THE FORM BECOMES FOUR STEPS. A campaign is four decisions — what to
// send, who to send it to, when it goes, and then sending it. Naming them
// costs four short labels and replaces the undifferentiated scroll with
// something you can see the shape of. They are steps, not an accordion:
// everything stays visible and editable, because you do revisit the name
// after picking recipients.
//
// NESTED BOXES BECOME RULES. The blocker banner, the variants editor, the
// advanced panel and the schedule block were each a bordered or tinted box
// inside the page's own bordered box. Sections are separated by a hairline
// and space instead, so there is one card on the left, not five.
//
// A/B VARIANTS AND ADVANCED SETTINGS COLLAPSE. Both are genuinely
// occasional, and both were permanently expanded structures competing with
// the fields you use every time.

const TEMPLATES = ['September newsletter', 'Welcome email', 'Autumn offer', 'Re-engagement'];

const CHECKS = [
  { label: 'Subject line set', ok: true },
  { label: 'Unsubscribe link present', ok: true },
  { label: 'Images reachable', ok: true },
  { label: 'Plain-text alternative', ok: false, note: 'Auto-generated on send' },
];

export function Builder() {
  const [when, setWhen] = useState('now');
  const [advanced, setAdvanced] = useState(false);
  const [variants, setVariants] = useState(false);

  return (
    <div className="bd-grid">
      <section className="bd-card">
        <ol className="bd-steps">
          <li className="bd-step">
            <span className="bd-step-head">
              <span className="bd-step-n">1</span>
              <span className="bd-step-title">What to send</span>
            </span>
            <div className="bd-step-body">
              <label className="bd-field">
                Campaign name
                <input defaultValue="September newsletter" />
              </label>
              <label className="bd-field">
                Template
                <select defaultValue={TEMPLATES[0]}>
                  {TEMPLATES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
            </div>
          </li>

          <li className="bd-step">
            <span className="bd-step-head">
              <span className="bd-step-n">2</span>
              <span className="bd-step-title">Who receives it</span>
            </span>
            <div className="bd-step-body">
              <button type="button" className="bd-picker">
                <Users size={15} aria-hidden="true" />
                <span className="bd-picker-text">
                  <span>Newsletter subscribers, Customers</span>
                  <span className="bd-dim">2,144 people after suppressions</span>
                </span>
                <ChevronDown size={15} aria-hidden="true" />
              </button>
            </div>
          </li>

          <li className="bd-step">
            <span className="bd-step-head">
              <span className="bd-step-n">3</span>
              <span className="bd-step-title">When it goes</span>
            </span>
            <div className="bd-step-body">
              <div className="bd-choice">
                {[['now', 'Send now'], ['later', 'Schedule']].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`bd-choice-btn${when === key ? ' is-active' : ''}`}
                    aria-pressed={when === key}
                    onClick={() => setWhen(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {when === 'later' && (
                <div className="bd-schedule">
                  <label className="bd-field">
                    Date and time
                    <input type="datetime-local" defaultValue="2026-09-14T09:00" />
                  </label>
                  <label className="bd-field">
                    Repeat
                    <select defaultValue="once">
                      <option value="once">Once</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </label>
                  <label className="bd-check bd-field-wide">
                    <input type="checkbox" />
                    Send at 09:00 in each recipient&apos;s timezone
                  </label>
                </div>
              )}
            </div>
          </li>

          <li className="bd-step">
            <span className="bd-step-head">
              <span className="bd-step-n">4</span>
              <span className="bd-step-title">Check and send</span>
            </span>
            <div className="bd-step-body">
              <div className="bd-test">
                <label className="bd-field">
                  Send a test to
                  <input type="email" defaultValue="sanmi@purify-tech.co.uk" />
                </label>
                <button type="button" className="bd-btn">Send test</button>
                <button type="button" className="bd-btn">
                  <Eye size={14} aria-hidden="true" /> Inbox preview
                </button>
              </div>
            </div>
          </li>
        </ol>

        <div className="bd-extras">
          <button
            type="button"
            className={`bd-disclose${variants ? ' is-open' : ''}`}
            aria-expanded={variants}
            onClick={() => setVariants((v) => !v)}
          >
            <ChevronDown size={14} aria-hidden="true" /> A/B test the subject line
          </button>
          {variants && (
            <div className="bd-panel">
              <label className="bd-field">
                Variant A subject
                <input defaultValue="Three things worth five minutes" />
              </label>
              <label className="bd-field">
                Variant B subject
                <input defaultValue="Your September roundup" />
              </label>
              <p className="bd-dim">Split evenly. The winner is not sent automatically.</p>
            </div>
          )}

          <button
            type="button"
            className={`bd-disclose${advanced ? ' is-open' : ''}`}
            aria-expanded={advanced}
            onClick={() => setAdvanced((v) => !v)}
          >
            <ChevronDown size={14} aria-hidden="true" /> Sending rate and consent
          </button>
          {advanced && (
            <div className="bd-panel">
              <label className="bd-field">
                Batch size
                <input type="number" defaultValue="200" />
              </label>
              <label className="bd-field">
                Delay between batches
                <input type="number" defaultValue="2" />
              </label>
              <label className="bd-check bd-field-wide">
                <input type="checkbox" defaultChecked />
                Only send to contacts who agreed to receive email
              </label>
              <label className="bd-check bd-field-wide">
                <input type="checkbox" defaultChecked />
                Skip contacts who opted out of this category
              </label>
            </div>
          )}
        </div>
      </section>

      <aside className="bd-card bd-review">
        <div className="bd-review-head">
          <h2>Review</h2>
        </div>

        <dl className="bd-summary">
          <div><dt>Template</dt><dd>September newsletter</dd></div>
          <div><dt>Recipients</dt><dd>2,144</dd></div>
          <div><dt>Sending</dt><dd>{when === 'now' ? 'Immediately' : '14 Sep, 09:00'}</dd></div>
          <div><dt>From</dt><dd>hello@usecomplier.com</dd></div>
        </dl>

        <ul className="bd-checks">
          {CHECKS.map((c) => (
            <li key={c.label} className={`bd-checkrow${c.ok ? '' : ' is-warn'}`}>
              <span className="bd-checkmark" aria-hidden="true">
                {c.ok ? <Check size={11} /> : '!'}
              </span>
              <span className="bd-checktext">
                {c.label}
                {c.note && <span className="bd-dim">{c.note}</span>}
              </span>
            </li>
          ))}
        </ul>

        {/* One primary action, and the consequence stated on it rather than
            in a sentence above it. The old page carried "Emails will start
            going out immediately. This cannot be undone." as standing
            copy — it belongs in the confirm step, not on the form. */}
        <button type="button" className="bd-send">
          <Send size={15} aria-hidden="true" />
          {when === 'now' ? 'Send to 2,144 people' : 'Schedule for 14 Sep'}
        </button>
      </aside>
    </div>
  );
}
