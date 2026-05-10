import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';

const FREQUENCIES = ['once', 'daily', 'weekly', 'monthly'];

export function EditCampaignModal({ campaign, onSave, onCancel }) {
  const status = campaign.status;
  const canReschedule = status === 'scheduled' || status === 'draft';
  const initialDate = campaign.scheduledAt
    ? toLocalInput(new Date(campaign.scheduledAt))
    : '';
  const [name, setName] = useState(campaign.name || '');
  const [scheduledAt, setScheduledAt] = useState(initialDate);
  const [frequency, setFrequency] = useState(campaign.schedule?.frequency || 'once');
  const [submitting, setSubmitting] = useState(false);
  const cancelRef = useRef(null);
  const nameId = useId();
  const dateId = useId();
  const freqId = useId();

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(event) { if (event.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const nameChanged = name.trim() && name.trim() !== campaign.name;
  const dateChanged = canReschedule && scheduledAt && scheduledAt !== initialDate;
  const freqChanged = canReschedule && frequency !== (campaign.schedule?.frequency || 'once');
  const canSave = (nameChanged || dateChanged || freqChanged) && name.trim().length > 0;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSave || submitting) return;
    setSubmitting(true);
    try {
      const payload = {};
      if (nameChanged) payload.name = name.trim();
      if (dateChanged) payload.scheduledAt = new Date(scheduledAt).toISOString();
      if (freqChanged) payload.frequency = frequency;
      await onSave(payload);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit campaign">
      <form className="modal-card surface user-modal" onSubmit={handleSubmit}>
        <div className="edit-contact-header">
          <div>
            <h2>Edit campaign</h2>
            <span className="muted">{statusLabel(status)}</span>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <label htmlFor={nameId}>
          Campaign name
          <input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>

        {canReschedule && (
          <div className="edit-contact-grid">
            <label htmlFor={dateId}>
              Scheduled time
              <input
                id={dateId}
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </label>
            <label htmlFor={freqId}>
              Repeat
              <select
                id={freqId}
                value={frequency}
                onChange={(event) => setFrequency(event.target.value)}
              >
                {FREQUENCIES.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {!canReschedule && (
          <p className="muted">
            This campaign is {statusLabel(status).toLowerCase()}, so only the name can be changed.
          </p>
        )}

        <div className="modal-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={submitting || !canSave}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

function toLocalInput(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function statusLabel(status) {
  if (status === 'completed_with_errors') return 'Completed (errors)';
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1);
}
