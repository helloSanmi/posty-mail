import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Users } from 'lucide-react';
import { DateTimePicker } from './DateTimePicker';
import { GroupSelector } from './GroupSelector';

const FREQUENCY_LABEL = {
  once: 'Once',
  daily: 'Daily at this time',
  weekly: 'Weekly on this weekday',
  monthly: 'Monthly on this day',
};

export function CampaignForm({
  form,
  setForm,
  templateOptions,
  selectedTemplateId,
  onSelectTemplate,
  templateChosen = true,
  groups = [],
  selectedGroupIds = [],
  onSelectGroups,
  // Segments: optional. When passed, the recipients popover gets a "Segments"
  // section below the groups list so the admin can union a dynamic segment
  // into the audience. Omitting these props hides the section entirely,
  // keeping older call sites unchanged.
  segments = [],
  selectedSegmentIds = [],
  onSelectSegments,
  recipientsChosen = true,
  recipientCount = 0,
  recipientLoading = false,
}) {
  const nameId = useId();
  const templateId = useId();
  const recipientsId = useId();
  const frequencyId = useId();

  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const recipientsRef = useRef(null);

  // Close the popover on outside click or Escape.
  useEffect(() => {
    if (!recipientsOpen) return undefined;
    function onPointer(event) {
      if (!recipientsRef.current?.contains(event.target)) setRecipientsOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setRecipientsOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [recipientsOpen]);

  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
    } catch {
      return 'Local time';
    }
  }, []);

  const scheduleSummary = useMemo(() => {
    if (form.sendMode === 'now') return null;
    if (!form.scheduledAt) return 'Pick a date and time.';
    const date = new Date(form.scheduledAt);
    if (Number.isNaN(date.getTime())) return 'Invalid date.';
    const formatted = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
    if (date.getTime() <= Date.now()) {
      return `${formatted}. That's in the past, will send immediately.`;
    }
    return `${formatted} (${timezone}) · ${FREQUENCY_LABEL[form.frequency] || 'Once'}`;
  }, [form.sendMode, form.scheduledAt, form.frequency, timezone]);

  const recipientsSummary = !recipientsChosen
    ? 'Select recipients'
    : recipientLoading
      ? 'Counting…'
      : (() => {
          const parts = [];
          if (selectedGroupIds.length === 0 && selectedSegmentIds.length === 0) {
            parts.push('All contacts');
          } else {
            if (selectedGroupIds.length) parts.push(`${selectedGroupIds.length} group${selectedGroupIds.length === 1 ? '' : 's'}`);
            if (selectedSegmentIds.length) parts.push(`${selectedSegmentIds.length} segment${selectedSegmentIds.length === 1 ? '' : 's'}`);
          }
          parts.push(`${recipientCount.toLocaleString()} ${recipientCount === 1 ? 'person' : 'people'}`);
          return parts.join(' · ');
        })();

  return (
    <div className="send-form">
      {/* Every row uses the same `.form-field` shape (label-on-top, control
          below) so heights and label baselines align across columns. */}
      <div className="form-field send-form-full">
        <label htmlFor={nameId}>Campaign name</label>
        <input
          id={nameId}
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="Name this campaign"
        />
      </div>

      <div className="form-field">
        <label htmlFor={templateId}>Email template</label>
        <select id={templateId} value={selectedTemplateId} onChange={onSelectTemplate}>
          {!templateChosen && (
            <option value="" disabled>Select template…</option>
          )}
          {templateOptions.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </div>

      <div className="form-field send-recipients-field" ref={recipientsRef}>
        <label htmlFor={recipientsId}>Recipients</label>
        <button
          id={recipientsId}
          type="button"
          className={`send-recipients-trigger${!recipientsChosen ? ' is-placeholder' : ''}`}
          onClick={() => setRecipientsOpen((value) => !value)}
          aria-expanded={recipientsOpen}
          aria-haspopup="dialog"
        >
          <Users size={14} aria-hidden="true" />
          <span className="send-recipients-trigger-text">{recipientsSummary}</span>
          <ChevronDown size={14} aria-hidden="true" className="send-recipients-trigger-caret" />
        </button>
        {recipientsOpen && (
          <div className="send-recipients-popover" role="dialog" aria-label="Choose recipients">
            <GroupSelector
              compact
              groups={groups}
              selectedIds={selectedGroupIds}
              onChange={(ids) => onSelectGroups?.(ids)}
              showAllContactsOption
              emptyMessage="No groups yet. This campaign will go to All contacts."
            />
            {segments.length > 0 && (
              <div className="recipients-segments">
                <div className="recipients-segments-head">
                  <strong>Segments</strong>
                  <span className="muted">Add a dynamic list. Re-evaluated at send time.</span>
                </div>
                <ul className="recipients-segments-list">
                  {segments.map((segment) => {
                    const checked = selectedSegmentIds.includes(segment.id);
                    return (
                      <li key={segment.id}>
                        <label className={`recipients-segment-row${checked ? ' is-checked' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const next = checked
                                ? selectedSegmentIds.filter((id) => id !== segment.id)
                                : [...selectedSegmentIds, segment.id];
                              onSelectSegments?.(next);
                            }}
                          />
                          <span>{segment.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="form-field send-form-full send-when">
        <span className="send-when-label">When to send</span>
        <div className="send-when-options">
          <label className="radio-line">
            <input
              type="radio"
              name="sendMode"
              value="now"
              checked={form.sendMode === 'now'}
              onChange={() => setForm({ ...form, sendMode: 'now' })}
            />
            Send now
          </label>
          <label className="radio-line">
            <input
              type="radio"
              name="sendMode"
              value="schedule"
              checked={form.sendMode === 'schedule'}
              onChange={() => setForm({ ...form, sendMode: 'schedule' })}
            />
            Schedule for later
          </label>
        </div>
      </div>
      {form.sendMode === 'schedule' && (
        <>
          <div className="form-field">
            <span className="form-field-label-text">Send date &amp; time</span>
            <DateTimePicker
              value={form.scheduledAt}
              onChange={(next) => setForm({ ...form, scheduledAt: next })}
              min={toLocalInput(new Date())}
            />
          </div>
          <div className="form-field">
            <label htmlFor={frequencyId}>Repeat</label>
            <select
              id={frequencyId}
              value={form.frequency}
              onChange={(event) => setForm({ ...form, frequency: event.target.value })}
            >
              <option value="once">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          {scheduleSummary && (
            <p className="send-form-full schedule-summary">{scheduleSummary}</p>
          )}
          {/* Send-time per recipient timezone. Treats the chosen hour as a
              local-clock target. Each contact receives when their wall clock
              hits that time. Contacts with no stored timezone fall back to UTC. */}
          <label className="checkbox-line send-form-full">
            <input
              type="checkbox"
              checked={Boolean(form.useRecipientTimezone)}
              onChange={(event) => setForm({ ...form, useRecipientTimezone: event.target.checked })}
            />
            Send at each recipient&apos;s local time
            <span className="muted" style={{ marginLeft: 6 }}>
              (uses the stored timezone on each contact; UTC otherwise)
            </span>
          </label>
        </>
      )}
    </div>
  );
}

function toLocalInput(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
