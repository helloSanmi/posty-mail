import { useEffect, useState } from 'react';
import { ArrowDown, Plus, Save, Trash2, Workflow } from 'lucide-react';
import {
  defaultTemplates as defaultTemplatesList,
} from '../templates/defaultTemplates';
import {
  deleteSequence,
  getGroups,
  getSavedTemplates,
  getSequences,
  saveSequence,
} from '../services/brevoApi';
import { ConfirmDialog } from '../components/ConfirmDialog';

// Drip-sequence management.
//
// Layout: list of saved sequences on the left, composer on the right. The
// composer is a vertical step ladder: each step is (delayDays, template).
// Step 0 typically has delayDays=0 and fires on enrollment.
//
// Triggering: v1 supports 'group_added' (when a contact lands in a chosen
// group). Future triggers (event-based, manual-only) plug in via the
// `triggerType` enum.

const EMPTY_DRAFT = () => ({
  id: undefined,
  name: '',
  status: 'active',
  triggerType: 'group_added',
  triggerGroupId: '',
  steps: [{ order: 0, delayDays: 0, templateId: '' }],
});

export function SequencesPage({ notify }) {
  const [sequences, setSequences] = useState([]);
  const [groups, setGroups] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getSequences().catch(() => []),
      getGroups().catch(() => []),
      getSavedTemplates().catch(() => []),
    ]).then(([s, g, t]) => {
      if (cancelled) return;
      setSequences(s);
      setGroups(g);
      // Merge built-in defaults + saved templates so the step picker shows
      // everything an admin might want.
      setTemplates([...defaultTemplatesList, ...t]);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  function startNew() {
    setDraft(EMPTY_DRAFT());
  }

  function edit(seq) {
    setDraft({
      id: seq.id,
      name: seq.name,
      status: seq.status,
      triggerType: seq.triggerType,
      triggerGroupId: seq.triggerGroupId || '',
      steps: seq.steps.length ? seq.steps : [{ order: 0, delayDays: 0, templateId: '' }],
    });
  }

  function updateDraft(patch) {
    setDraft((prev) => prev && { ...prev, ...patch });
  }

  function updateStep(index, patch) {
    setDraft((prev) => {
      if (!prev) return prev;
      const steps = prev.steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
      return { ...prev, steps };
    });
  }

  function addStep() {
    setDraft((prev) => prev && {
      ...prev,
      steps: [...prev.steps, { order: prev.steps.length, delayDays: 3, templateId: '' }],
    });
  }

  function removeStep(index) {
    setDraft((prev) => {
      if (!prev) return prev;
      const steps = prev.steps
        .filter((_, i) => i !== index)
        .map((step, i) => ({ ...step, order: i }));
      return { ...prev, steps: steps.length ? steps : [{ order: 0, delayDays: 0, templateId: '' }] };
    });
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      notify?.('Give the sequence a name first.', 'error');
      return;
    }
    const cleaned = draft.steps
      .map((step, i) => ({
        order: i,
        delayDays: Number(step.delayDays) || 0,
        templateId: String(step.templateId || '').trim(),
      }))
      .filter((s) => s.templateId);
    if (!cleaned.length) {
      notify?.('Add at least one step with a template.', 'error');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveSequence({
        id: draft.id,
        name: draft.name.trim(),
        status: draft.status,
        triggerType: draft.triggerType,
        triggerGroupId: draft.triggerGroupId || null,
        steps: cleaned,
      });
      setSequences((prev) => {
        const without = prev.filter((s) => s.id !== saved.id);
        return [saved, ...without];
      });
      setDraft({ ...draft, id: saved.id });
      notify?.(`Sequence "${saved.name}" saved`);
    } catch (error) {
      notify?.(error.response?.data?.error || 'Could not save sequence', 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(seq) {
    setConfirm({
      title: `Delete sequence "${seq.name}"?`,
      message: 'Enrollments cascade. In-flight contacts stop receiving the remaining steps.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await deleteSequence(seq.id);
          setSequences((prev) => prev.filter((s) => s.id !== seq.id));
          if (draft?.id === seq.id) setDraft(null);
          notify?.('Sequence deleted');
        } catch (error) {
          notify?.(error.response?.data?.error || 'Could not delete sequence', 'error');
        }
      },
    });
  }

  return (
    <div className="page-stack content-page sequences-page">
      <header className="sequences-header">
        <div>
          <h2>Sequences</h2>
          <p className="muted">
            Drip campaigns. When a contact gets added to the trigger group, they automatically
            receive these emails on the schedule below.
          </p>
        </div>
        <button type="button" className="primary" onClick={startNew}>
          <Plus size={14} aria-hidden="true" /> New sequence
        </button>
      </header>

      <section className="sequences-shell">
        <aside className="surface sequences-list-pane">
          {loading ? (
            <p className="muted">Loading…</p>
          ) : sequences.length === 0 ? (
            <p className="muted">No sequences yet.</p>
          ) : (
            <ul className="sequences-list">
              {sequences.map((seq) => (
                <li key={seq.id}>
                  <button
                    type="button"
                    className={`sequence-row${draft?.id === seq.id ? ' is-active' : ''}`}
                    onClick={() => edit(seq)}
                  >
                    <span>
                      <strong>{seq.name}</strong>
                      <span className="muted">
                        {seq.steps.length} step{seq.steps.length === 1 ? '' : 's'} ·{' '}
                        {seq.status === 'active' ? 'Active' : 'Paused'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="surface sequences-composer">
          {!draft ? (
            <div className="empty-state">
              <Workflow size={20} aria-hidden="true" />
              <p>Pick a sequence to edit, or click <strong>New sequence</strong> to start.</p>
            </div>
          ) : (
            <SequenceComposer
              draft={draft}
              updateDraft={updateDraft}
              updateStep={updateStep}
              addStep={addStep}
              removeStep={removeStep}
              groups={groups}
              templates={templates}
              onSave={save}
              onDelete={() => draft.id && handleDelete({ id: draft.id, name: draft.name })}
              saving={saving}
            />
          )}
        </section>
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

function SequenceComposer({ draft, updateDraft, updateStep, addStep, removeStep, groups, templates, onSave, onDelete, saving }) {
  return (
    <div className="composer-body">
      <div className="composer-name-row">
        <label>
          Name
          <input
            value={draft.name}
            onChange={(event) => updateDraft({ name: event.target.value })}
            placeholder="e.g. New subscriber welcome series"
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
            <Save size={14} aria-hidden="true" /> {saving ? 'Saving…' : 'Save sequence'}
          </button>
        </div>
      </div>

      <fieldset className="composer-fieldset">
        <legend>Trigger</legend>
        <div className="composer-trigger-row">
          <label>
            When
            <select
              value={draft.triggerType}
              onChange={(event) => updateDraft({ triggerType: event.target.value })}
            >
              <option value="group_added">a contact is added to a group</option>
              <option value="manual">(manual enrollment only)</option>
            </select>
          </label>
          {draft.triggerType === 'group_added' && (
            <label>
              Group
              <select
                value={draft.triggerGroupId || ''}
                onChange={(event) => updateDraft({ triggerGroupId: event.target.value })}
              >
                <option value="">Pick a group…</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Status
            <select
              value={draft.status}
              onChange={(event) => updateDraft({ status: event.target.value })}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="composer-fieldset">
        <legend>Steps</legend>
        <ol className="sequence-steps">
          {draft.steps.map((step, index) => (
            <li key={index}>
              <div className="sequence-step">
                <span className="sequence-step-index" aria-hidden="true">{index + 1}</span>
                <div className="sequence-step-fields">
                  <label>
                    {index === 0 ? 'On enrollment' : 'Wait'}
                    <div className="sequence-step-delay">
                      <input
                        type="number"
                        min="0"
                        max="365"
                        value={step.delayDays}
                        onChange={(event) => updateStep(index, { delayDays: event.target.value })}
                        disabled={index === 0 && Number(step.delayDays) === 0}
                      />
                      <span className="muted">day{Number(step.delayDays) === 1 ? '' : 's'}</span>
                    </div>
                  </label>
                  <label>
                    Send template
                    <select
                      value={step.templateId}
                      onChange={(event) => updateStep(index, { templateId: event.target.value })}
                    >
                      <option value="">Pick a template…</option>
                      {templates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  className="sequence-step-remove"
                  onClick={() => removeStep(index)}
                  aria-label="Remove step"
                  title="Remove step"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
              {index < draft.steps.length - 1 && (
                <div className="sequence-step-arrow" aria-hidden="true">
                  <ArrowDown size={14} />
                </div>
              )}
            </li>
          ))}
        </ol>
        <button type="button" className="composer-add-rule" onClick={addStep}>
          <Plus size={14} aria-hidden="true" /> Add step
        </button>
      </fieldset>
    </div>
  );
}
