import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

// Right-rail summary shown on the campaign builder. The Audience and
// "Not included" rows are expandable — clicking the count reveals a
// scrollable list of the actual people in that bucket so the admin can
// eyeball who's about to receive (or be skipped by) the send before
// committing. Held contacts also show the compliance reason they were
// excluded for.
export function SendReview({
  readyContacts, readyList = [], template, frequency, held, heldList = [], batches,
}) {
  return (
    <aside className="surface send-summary">
      <h2 className="review-title">Review</h2>
      <dl className="review-list">
        <PeopleRow
          label="Audience"
          count={readyContacts}
          people={readyList}
          emptyValue="No audience"
        />
        <ReviewItem label="Email" value={template.name || 'Selected email'} />
        <ReviewItem label="Repeat" value={frequency === 'once' ? 'Once' : frequency} />
        <PeopleRow
          label="Not included"
          count={held}
          people={heldList.map((entry) => ({ ...entry.contact, reasons: entry.reasons }))}
          emptyValue="0 people"
          tone="held"
        />
        <ReviewItem label="Send batches" value={batches.length} />
      </dl>
    </aside>
  );
}

function ReviewItem({ label, value }) {
  return (
    <div className="review-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// A review row whose value is a clickable people-count. Expands to a
// scrollable list of contacts. Collapses by default to keep the panel
// compact. When count is 0 it renders as a plain non-clickable row.
function PeopleRow({ label, count, people, emptyValue, tone }) {
  const [open, setOpen] = useState(false);
  const hasPeople = count > 0 && people.length > 0;
  const valueText = count ? `${count} ${count === 1 ? 'person' : 'people'}` : emptyValue;

  if (!hasPeople) {
    return (
      <div className="review-row">
        <dt>{label}</dt>
        <dd>{valueText}</dd>
      </div>
    );
  }

  return (
    <div className="review-row review-row-expandable">
      <div className="review-row-main">
        <dt>{label}</dt>
        <dd>
          <button
            type="button"
            className={`review-people-toggle${open ? ' is-open' : ''}`}
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            {valueText}
            <ChevronDown size={13} aria-hidden="true" />
          </button>
        </dd>
      </div>
      {open && (
        <ul className={`review-people-list${tone === 'held' ? ' is-held' : ''}`}>
          {people.map((person) => {
            const fullName = [person.firstname, person.lastname].filter(Boolean).join(' ');
            return (
              <li key={person.email} className="review-people-item">
                <span className="review-people-avatar" aria-hidden="true">
                  {(person.firstname || person.email || '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="review-people-text">
                  {fullName && <strong>{fullName}</strong>}
                  <span className="review-people-email">{person.email}</span>
                  {Array.isArray(person.reasons) && person.reasons.length > 0 && (
                    <span className="review-people-reason">{person.reasons.join(' · ')}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
