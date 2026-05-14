import { useEffect, useRef, useState } from 'react';
import { Plus, Save, Trash2, Users } from 'lucide-react';
import {
  deleteSegment,
  getGroups,
  getSegments,
  previewSegmentFilter,
  saveSegment,
} from '../services/brevoApi';
import { ConfirmDialog } from '../components/ConfirmDialog';

// Dynamic segment management.
//
// Layout: list of saved segments on the left, composer in the center, live
// preview on the right. The composer is a small rules engine. each rule is
// (field, op, value), combined by AND or OR. Plus extras: date range on
// when the contact was added, and any-of-these-groups membership.
//
// Live preview re-fires (debounced) whenever the working filter changes, so
// the admin sees "matches N contacts" in real time before saving.

const PREVIEW_DEBOUNCE_MS = 400;

const FIELDS = [
  { value: 'email', label: 'Email' },
  { value: 'firstname', label: 'First name' },
  { value: 'lastname', label: 'Last name' },
  { value: 'region', label: 'Region' },
  { value: 'consent', label: 'Consent' },
];

const OPS = [
  { value: 'equals', label: 'is', wantsValue: true },
  { value: 'not_equals', label: 'is not', wantsValue: true },
  { value: 'contains', label: 'contains', wantsValue: true },
  { value: 'not_contains', label: 'does not contain', wantsValue: true },
  { value: 'is_empty', label: 'is empty', wantsValue: false },
  { value: 'is_not_empty', label: 'is not empty', wantsValue: false },
];

const EMPTY_FILTER = {
  rules: [],
  combinator: 'AND',
  addedAfter: '',
  addedBefore: '',
  inAnyGroup: [],
  excludeUnsubscribed: false,
};

function emptyRule() {
  return { field: 'email', op: 'contains', value: '' };
}

export function SegmentsPage({ notify }) {
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  // Active draft. null = nothing selected. The draft can be a new segment
  // (no id) or an edit of an existing one (with id).
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const previewTimerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getSegments().catch(() => []),
      getGroups().catch(() => []),
    ]).then(([s, g]) => {
      if (cancelled) return;
      setSegments(s);
      setGroups(g);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Debounced live preview whenever the working filter changes.
  useEffect(() => {
    if (!draft) {
      setPreview(null);
      return undefined;
    }
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    let cancelled = false;
    setPreviewLoading(true);
    previewTimerRef.current = setTimeout(async () => {
      try {
        const data = await previewSegmentFilter(draft.filter);
        if (!cancelled) setPreview(data);
      } catch {
        if (!cancelled) setPreview({ count: 0, sample: [], error: true });
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, [draft]);

  function startNew() {
    setDraft({ id: undefined, name: '', filter: { ...EMPTY_FILTER, rules: [emptyRule()] } });
  }

  function edit(segment) {
    setDraft({
      id: segment.id,
      name: segment.name,
      filter: { ...EMPTY_FILTER, ...(segment.filter || {}) },
    });
  }

  function updateFilter(patch) {
    setDraft((current) => current && {
      ...current,
      filter: { ...current.filter, ...patch },
    });
  }

  function updateRule(index, patch) {
    setDraft((current) => {
      if (!current) return current;
      const rules = [...(current.filter.rules || [])];
      rules[index] = { ...rules[index], ...patch };
      return { ...current, filter: { ...current.filter, rules } };
    });
  }

  function addRule() {
    setDraft((current) => current && {
      ...current,
      filter: { ...current.filter, rules: [...(current.filter.rules || []), emptyRule()] },
    });
  }

  function removeRule(index) {
    setDraft((current) => {
      if (!current) return current;
      const rules = (current.filter.rules || []).filter((_, i) => i !== index);
      return { ...current, filter: { ...current.filter, rules } };
    });
  }

  function toggleGroup(id) {
    setDraft((current) => {
      if (!current) return current;
      const list = current.filter.inAnyGroup || [];
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      return { ...current, filter: { ...current.filter, inAnyGroup: next } };
    });
  }

  async function handleSave() {
    if (!draft) return;
    if (!draft.name.trim()) {
      notify?.('Give the segment a name first.', 'error');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveSegment({
        id: draft.id,
        name: draft.name.trim(),
        filter: serializeFilter(draft.filter),
      });
      setSegments((prev) => {
        const without = prev.filter((s) => s.id !== saved.id);
        return [saved, ...without];
      });
      setDraft({ ...draft, id: saved.id });
      notify?.(`Segment "${saved.name}" saved`);
    } catch (error) {
      notify?.(error.response?.data?.error || 'Could not save segment', 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(segment) {
    setConfirm({
      title: `Delete segment "${segment.name}"?`,
      message: 'Removing the segment does not delete any contacts. Campaigns that referenced it stay sent.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await deleteSegment(segment.id);
          setSegments((prev) => prev.filter((s) => s.id !== segment.id));
          if (draft?.id === segment.id) setDraft(null);
          notify?.('Segment deleted');
        } catch (error) {
          notify?.(error.response?.data?.error || 'Could not delete segment', 'error');
        }
      },
    });
  }

  return (
    <div className="page-stack content-page segments-page">
      <header className="segments-header">
        <div>
          <h2>Segments</h2>
          <p className="muted">Dynamic recipient lists. Rules re-evaluate at send time, so new contacts that match the rules are automatically included.</p>
        </div>
        <button type="button" className="primary" onClick={startNew}>
          <Plus size={14} aria-hidden="true" /> New segment
        </button>
      </header>

      <section className="segments-shell">
        <aside className="surface segments-list-pane">
          {loading ? (
            <p className="muted">Loading…</p>
          ) : segments.length === 0 ? (
            <p className="muted">No segments yet. Click <strong>New segment</strong> to create one.</p>
          ) : (
            <ul className="segments-list">
              {segments.map((segment) => (
                <li key={segment.id}>
                  <button
                    type="button"
                    className={`segment-row${draft?.id === segment.id ? ' is-active' : ''}`}
                    onClick={() => edit(segment)}
                  >
                    <span className="segment-row-name">{segment.name}</span>
                    <span className="muted segment-row-meta">
                      {ruleSummary(segment.filter)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="surface segments-composer">
          {!draft ? (
            <div className="empty-state">
              <Users size={20} aria-hidden="true" />
              <p>Pick a segment to edit, or click <strong>New segment</strong> to start.</p>
            </div>
          ) : (
            <Composer
              draft={draft}
              setDraft={setDraft}
              updateFilter={updateFilter}
              updateRule={updateRule}
              addRule={addRule}
              removeRule={removeRule}
              groups={groups}
              toggleGroup={toggleGroup}
              onSave={handleSave}
              onDelete={() => draft.id && handleDelete({ id: draft.id, name: draft.name })}
              saving={saving}
            />
          )}
        </section>

        <aside className="surface segments-preview-pane">
          <h3>Live preview</h3>
          {!draft ? (
            <p className="muted">Edit a segment to see who matches.</p>
          ) : previewLoading ? (
            <p className="muted">Counting…</p>
          ) : preview?.error ? (
            <p className="muted">Could not run preview.</p>
          ) : (
            <>
              <div className="segments-preview-count">
                <strong>{preview?.count ?? 0}</strong>
                <span className="muted">matching contacts</span>
              </div>
              <ul className="segments-preview-list">
                {(preview?.sample || []).slice(0, 10).map((contact) => (
                  <li key={contact.email}>
                    <strong>{contact.firstname || contact.lastname ? `${contact.firstname || ''} ${contact.lastname || ''}`.trim() : contact.email}</strong>
                    {(contact.firstname || contact.lastname) && (
                      <span className="muted">{contact.email}</span>
                    )}
                  </li>
                ))}
                {(preview?.sample?.length || 0) === 0 && (
                  <li className="muted">No contacts match yet.</li>
                )}
              </ul>
            </>
          )}
        </aside>
      </section>

      {confirm && (
        <ConfirmDialog
          {...confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => { await confirm.onConfirm(); setConfirm(null); }}
        />
      )}
    </div>
  );
}

// Composer body. Split out so the parent stays readable.
function Composer({ draft, setDraft, updateFilter, updateRule, addRule, removeRule, groups, toggleGroup, onSave, onDelete, saving }) {
  const filter = draft.filter;
  return (
    <div className="composer-body">
      <div className="composer-name-row">
        <label>
          Name
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="e.g. US subscribers added this month"
            autoFocus
          />
        </label>
        <div className="composer-actions">
          {draft.id && (
            <button type="button" className="danger" onClick={onDelete}>
              <Trash2 size={14} aria-hidden="true" /> Delete
            </button>
          )}
          <button type="button" className="primary" onClick={onSave} disabled={saving}>
            <Save size={14} aria-hidden="true" /> {saving ? 'Saving…' : 'Save segment'}
          </button>
        </div>
      </div>

      <fieldset className="composer-fieldset">
        <legend>Rules</legend>
        <div className="composer-combinator">
          Match
          <select
            value={filter.combinator || 'AND'}
            onChange={(event) => updateFilter({ combinator: event.target.value })}
            aria-label="Combine rules"
          >
            <option value="AND">all</option>
            <option value="OR">any</option>
          </select>
          of these rules:
        </div>

        {(filter.rules || []).length === 0 && (
          <p className="muted composer-empty">No rules yet. Add one to start narrowing the audience.</p>
        )}

        {(filter.rules || []).map((rule, index) => {
          const op = OPS.find((o) => o.value === rule.op);
          return (
            <div key={index} className="composer-rule">
              <select
                value={rule.field}
                onChange={(event) => updateRule(index, { field: event.target.value })}
                aria-label="Field"
              >
                {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <select
                value={rule.op}
                onChange={(event) => updateRule(index, { op: event.target.value })}
                aria-label="Operator"
              >
                {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {op?.wantsValue ? (
                <input
                  value={rule.value || ''}
                  onChange={(event) => updateRule(index, { value: event.target.value })}
                  placeholder="value"
                  aria-label="Value"
                />
              ) : (
                <span className="composer-rule-spacer" aria-hidden="true" />
              )}
              <button
                type="button"
                className="composer-rule-remove"
                onClick={() => removeRule(index)}
                aria-label="Remove rule"
                title="Remove rule"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}

        <button type="button" className="composer-add-rule" onClick={addRule}>
          <Plus size={14} aria-hidden="true" /> Add rule
        </button>
      </fieldset>

      <fieldset className="composer-fieldset">
        <legend>Added between</legend>
        <div className="composer-date-row">
          <label>
            After
            <input
              type="date"
              value={filter.addedAfter || ''}
              onChange={(event) => updateFilter({ addedAfter: event.target.value })}
            />
          </label>
          <label>
            Before
            <input
              type="date"
              value={filter.addedBefore || ''}
              onChange={(event) => updateFilter({ addedBefore: event.target.value })}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="composer-fieldset">
        <legend>Must be in any of these groups</legend>
        {groups.length === 0 ? (
          <p className="muted">No groups exist yet. Skip this filter.</p>
        ) : (
          <div className="composer-group-chips">
            {groups.map((group) => {
              const checked = (filter.inAnyGroup || []).includes(group.id);
              return (
                <label key={group.id} className={`composer-group-chip${checked ? ' is-checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleGroup(group.id)}
                  />
                  {group.name}
                  <span className="muted">{(group.contactEmails || []).length}</span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      <fieldset className="composer-fieldset">
        <legend>Suppression</legend>
        <label className="composer-checkbox-row">
          <input
            type="checkbox"
            checked={Boolean(filter.excludeUnsubscribed)}
            onChange={(event) => updateFilter({ excludeUnsubscribed: event.target.checked })}
          />
          Exclude people who have unsubscribed
        </label>
      </fieldset>
    </div>
  );
}

// Strip transient/empty values before save so the persisted filter is clean.
function serializeFilter(filter) {
  const out = {};
  if (Array.isArray(filter.rules)) {
    const rules = filter.rules.filter((r) => r && r.field && r.op);
    if (rules.length) out.rules = rules;
  }
  if (filter.combinator === 'OR') out.combinator = 'OR';
  if (filter.addedAfter) out.addedAfter = filter.addedAfter;
  if (filter.addedBefore) out.addedBefore = filter.addedBefore;
  if (Array.isArray(filter.inAnyGroup) && filter.inAnyGroup.length) out.inAnyGroup = filter.inAnyGroup;
  if (filter.excludeUnsubscribed) out.excludeUnsubscribed = true;
  return out;
}

// One-liner summary used in the list view. Keeps row heights small while
// still hinting at what the segment does.
function ruleSummary(filter) {
  if (!filter || typeof filter !== 'object') return 'No rules';
  const parts = [];
  const ruleCount = Array.isArray(filter.rules) ? filter.rules.length : 0;
  if (ruleCount) parts.push(`${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'}`);
  if (filter.inAnyGroup?.length) parts.push(`${filter.inAnyGroup.length} group filter`);
  if (filter.addedAfter || filter.addedBefore) parts.push('date range');
  if (filter.excludeUnsubscribed) parts.push('excl. unsubscribed');
  return parts.length ? parts.join(' · ') : 'No rules';
}
