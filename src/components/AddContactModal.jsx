import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { otherCountryOptions, priorityCountryOptions } from '../data/countries';
import { EMAIL_PATTERN } from '../../shared/campaignUtils.js';
import { GroupSelector } from './GroupSelector';

const blankContact = {
  email: '',
  firstname: '',
  lastname: '',
  consent: 'yes',
  region: 'US',
};

export function AddContactModal({ groups, onCreate, onCancel, defaultGroupId }) {
  const [draft, setDraft] = useState(blankContact);
  // Pre-select the group the admin is currently viewing (if any). Matches
  // the CSV-import behavior where the viewed group acts as a fallback
  // destination. If `defaultGroupId` isn't passed (no group in view), the
  // picker starts empty.
  const [selectedGroupIds, setSelectedGroupIds] = useState(
    defaultGroupId ? [defaultGroupId] : [],
  );
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const cancelRef = useRef(null);
  const emailId = useId();
  const firstId = useId();
  const lastId = useId();
  const regionId = useId();
  const consentId = useId();

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(event) { if (event.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const emailError = touched && draft.email && !EMAIL_PATTERN.test(draft.email)
    ? 'Invalid email format'
    : '';
  const valid = EMAIL_PATTERN.test(draft.email || '');

  async function handleSubmit(event) {
    event.preventDefault();
    setTouched(true);
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await onCreate(draft, selectedGroupIds);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add contact">
      <form className="modal-card surface user-modal" onSubmit={handleSubmit}>
        <div className="edit-contact-header">
          <h2>Add contact</h2>
          <button type="button" onClick={onCancel} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="edit-contact-grid">
          <label htmlFor={emailId}>
            Email
            <input
              id={emailId}
              type="email"
              required
              autoComplete="off"
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
              onBlur={() => setTouched(true)}
              placeholder="name@example.com"
              aria-invalid={Boolean(emailError)}
            />
            {emailError && <small className="field-error" role="alert">{emailError}</small>}
          </label>

          <label htmlFor={regionId}>
            Country/region
            <select
              id={regionId}
              value={draft.region}
              onChange={(event) => setDraft({ ...draft, region: event.target.value })}
            >
              {priorityCountryOptions.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
              <optgroup label="Other regions">
                {otherCountryOptions.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </optgroup>
            </select>
          </label>

          <label htmlFor={firstId}>
            First name
            <input
              id={firstId}
              value={draft.firstname}
              onChange={(event) => setDraft({ ...draft, firstname: event.target.value })}
              autoComplete="given-name"
            />
          </label>

          <label htmlFor={lastId}>
            Last name
            <input
              id={lastId}
              value={draft.lastname}
              onChange={(event) => setDraft({ ...draft, lastname: event.target.value })}
              autoComplete="family-name"
            />
          </label>

          <label htmlFor={consentId} className="checkbox-line edit-contact-consent">
            <input
              id={consentId}
              type="checkbox"
              checked={draft.consent === 'yes'}
              onChange={(event) => setDraft({ ...draft, consent: event.target.checked ? 'yes' : '' })}
            />
            Agreed to receive emails
          </label>
        </div>

        <div className="edit-contact-groups">
          <span className="template-field-label">Groups</span>
          <GroupSelector
            groups={groups}
            selectedIds={selectedGroupIds}
            onChange={setSelectedGroupIds}
            emptyMessage="No groups yet. You can create one from the sidebar after saving."
          />
        </div>

        <div className="modal-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={submitting || !valid}>
            {submitting ? 'Saving…' : 'Add contact'}
          </button>
        </div>
      </form>
    </div>
  );
}
