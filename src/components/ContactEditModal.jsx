import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { countryOptions } from '../data/countries';
import { EMAIL_PATTERN } from '../../shared/campaignUtils.js';
import { GroupSelector } from './GroupSelector';

export function ContactEditModal({ contact, groups = [], onSave, onCancel }) {
  const [draft, setDraft] = useState(contact);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const cancelRef = useRef(null);

  // Initial set of groups this contact already belongs to.
  const initialGroupIds = useMemo(
    () => groups
      .filter((group) => (group.contactEmails || []).includes(contact.email))
      .map((group) => group.id),
    [groups, contact.email],
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState(initialGroupIds);

  const emailId = useId();
  const firstId = useId();
  const lastId = useId();
  const regionId = useId();
  const consentId = useId();

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(event) {
      if (event.key === 'Escape') onCancel();
    }
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
    if (!valid) return;
    setSubmitting(true);
    try {
      const initial = new Set(initialGroupIds);
      const next = new Set(selectedGroupIds);
      const groupsToAdd = [...next].filter((id) => !initial.has(id));
      const groupsToRemove = [...initial].filter((id) => !next.has(id));
      await onSave(draft, { groupsToAdd, groupsToRemove });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit contact">
      <form className="modal-card edit-contact-card surface" onSubmit={handleSubmit}>
        <div className="edit-contact-header">
          <h2>Edit contact</h2>
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
              value={draft.email || ''}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
              onBlur={() => setTouched(true)}
              aria-invalid={Boolean(emailError)}
              required
            />
            {emailError && <span className="field-error" role="alert">{emailError}</span>}
          </label>

          <label htmlFor={regionId}>
            Country/region
            <select
              id={regionId}
              value={draft.region || 'US'}
              onChange={(event) => setDraft({ ...draft, region: event.target.value })}
            >
              {countryOptions.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label htmlFor={firstId}>
            First name
            <input
              id={firstId}
              value={draft.firstname || ''}
              onChange={(event) => setDraft({ ...draft, firstname: event.target.value })}
              autoComplete="given-name"
            />
          </label>

          <label htmlFor={lastId}>
            Last name
            <input
              id={lastId}
              value={draft.lastname || ''}
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
          />
        </div>

        <div className="modal-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={submitting || !valid}>
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
