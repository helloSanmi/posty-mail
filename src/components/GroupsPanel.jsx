import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { EyeOff, Eye, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  createGroup,
  deleteGroup,
  getGroups,
  renameGroup,
  setGroupDisabled,
} from '../services/brevoApi';
import { ConfirmDialog } from './ConfirmDialog';

// Natural-ordering collator so "Nest GRP 2" sits before "Nest GRP 10" and a
// bare "Nest GRP" sorts ahead of "Nest GRP 2" — matches what a human scanning
// the list expects. Created once at module load; instances are stateless.
const groupNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function GroupsPanel({
  notify,
  viewingGroupId,
  onView,
  refreshTick = 0,
  totalContacts = 0,
  onChange,
}) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(null);
  // Inline-rename state. `editingId` is the group currently in edit mode;
  // `editingName` is the working draft. We keep these here (not per-row)
  // so navigating away from the row commits / cancels deterministically.
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  // Display order = name, natural-sorted. The backend returns by updatedAt
  // (so freshly-touched groups float up), which is useful for some callers
  // but disorienting in a browse panel. Sorting here keeps the API stable.
  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => groupNameCollator.compare(a.name || '', b.name || '')),
    [groups],
  );

  async function refresh() {
    setLoading(true);
    try {
      const list = await getGroups();
      setGroups(list);
    } catch {
      // global toast handles it
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [refreshTick]);

  async function handleCreate(event) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      const created = await createGroup({ name: name.trim(), contacts: [] });
      setGroups((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setName('');
      setCreating(false);
      onChange?.();
      notify?.(`Group "${created.name}" created`);
    } catch (error) {
      notify?.(error.response?.data?.error || 'Could not create group', 'error');
    }
  }

  function handleDelete(group, event) {
    event.stopPropagation();
    setConfirm({
      title: `Delete group "${group.name}"?`,
      message: 'The group is removed but the contacts inside it stay in your audience.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await deleteGroup(group.id);
          setGroups((prev) => prev.filter((item) => item.id !== group.id));
          if (viewingGroupId === group.id) onView?.(null);
          onChange?.();
          notify?.('Group deleted');
        } catch (requestError) {
          notify?.(requestError.response?.data?.error || 'Could not delete group', 'error');
        }
      },
    });
  }

  function startRename(group, event) {
    event.stopPropagation();
    setEditingId(group.id);
    setEditingName(group.name);
  }

  function cancelRename() {
    setEditingId(null);
    setEditingName('');
  }

  async function commitRename(group) {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === group.name) {
      cancelRename();
      return;
    }
    try {
      const updated = await renameGroup(group.id, trimmed);
      setGroups((prev) => prev.map((item) => (item.id === group.id ? updated : item)));
      onChange?.();
      notify?.(`Group renamed to "${updated.name}"`);
    } catch (error) {
      notify?.(error.response?.data?.error || 'Could not rename group', 'error');
    } finally {
      cancelRename();
    }
  }

  async function handleToggleDisabled(group, event) {
    event.stopPropagation();
    const nextDisabled = !group.disabled;
    try {
      const updated = await setGroupDisabled(group.id, nextDisabled);
      setGroups((prev) => prev.map((item) => (item.id === group.id ? updated : item)));
      onChange?.();
      notify?.(nextDisabled
        ? `"${group.name}" disabled. It won't appear in the campaign recipient picker.`
        : `"${group.name}" enabled.`);
    } catch (requestError) {
      notify?.(requestError.response?.data?.error || 'Could not update group', 'error');
    }
  }

  return (
    <aside className="surface groups-sidebar">
      <div className="groups-sidebar-header">
        <strong>Groups</strong>
        <button
          type="button"
          className="row-action"
          onClick={() => setCreating((value) => !value)}
          aria-label="New group"
          title="New group"
          data-tooltip="New group"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>

      {creating && (
        <CreateGroupModal
          name={name}
          setName={setName}
          onSubmit={handleCreate}
          onCancel={() => { setCreating(false); setName(''); }}
        />
      )}

      <ul className="groups-sidebar-list">
        <li>
          <button
            type="button"
            className={`group-row${!viewingGroupId ? ' is-active' : ''}`}
            onClick={() => onView?.(null)}
            aria-pressed={!viewingGroupId}
          >
            <span className="group-name">All contacts</span>
            <span className="group-count">{totalContacts}</span>
            {/* Spacer mirrors the .group-row-actions width on real-group rows so
                count badges line up vertically across "All contacts" and named
                groups. Without it, this row's count would shift right by ~46px. */}
            <span className="group-row-actions-spacer" aria-hidden="true" />
          </button>
        </li>
        {loading && (
          <li className="muted groups-sidebar-loading">Loading…</li>
        )}
        {!loading && groups.length === 0 && (
          <li className="muted groups-sidebar-empty">
            No groups yet. Click <strong>+</strong> to create one.
          </li>
        )}
        {sortedGroups.map((group) => {
          const active = viewingGroupId === group.id;
          const disabled = Boolean(group.disabled);
          const isEditing = editingId === group.id;

          // Editing mode renders an input row instead of the button row. An
          // <input> can't live inside a <button>, and an actively-editing
          // row shouldn't double as a view-toggle anyway.
          if (isEditing) {
            return (
              <li key={group.id}>
                <RenameRow
                  initialName={editingName}
                  setName={setEditingName}
                  onCommit={() => commitRename(group)}
                  onCancel={cancelRename}
                />
              </li>
            );
          }

          return (
            <li key={group.id}>
              <button
                type="button"
                className={`group-row${active ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}
                onClick={() => onView?.(group.id)}
                aria-pressed={active}
                /* Only set a title on the row when the disabled state needs
                   surfacing — the group name itself is already visible right
                   inside the row, so a tooltip repeating it is noise AND it
                   competes with the action icons' own tooltips on hover
                   (some browsers prefer the parent's title over the child's). */
                title={disabled ? `Disabled. Hidden from the campaign recipient picker.` : undefined}
              >
                <span className="group-name">{group.name}</span>
                <span className="group-count">{(group.contactEmails || []).length}</span>
                <span className="group-row-actions">
                  <span
                    role="button"
                    tabIndex={0}
                    className="group-row-rename"
                    onClick={(event) => startRename(group, event)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        startRename(group, event);
                      }
                    }}
                    aria-label={`Rename ${group.name}`}
                    title="Rename group"
                    data-tooltip="Rename"
                  >
                    <Pencil size={12} aria-hidden="true" />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="group-row-toggle"
                    onClick={(event) => handleToggleDisabled(group, event)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleToggleDisabled(group, event);
                      }
                    }}
                    aria-label={disabled ? `Enable ${group.name}` : `Disable ${group.name}`}
                    title={disabled ? 'Enable group' : 'Disable group (hide from campaign picker)'}
                    data-tooltip={disabled ? 'Enable' : 'Disable'}
                  >
                    {disabled
                      ? <Eye size={12} aria-hidden="true" />
                      : <EyeOff size={12} aria-hidden="true" />}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="group-row-delete"
                    onClick={(event) => handleDelete(group, event)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleDelete(group, event);
                      }
                    }}
                    aria-label={`Delete ${group.name}`}
                    title="Delete group"
                    data-tooltip="Delete"
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {confirm && (
        <ConfirmDialog
          {...confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await confirm.onConfirm();
            setConfirm(null);
          }}
        />
      )}
    </aside>
  );
}

// Inline rename row. Renders in place of the normal group-row button while
// editing. Enter commits, Escape cancels, blur commits — same conventions as
// the contacts table's inline edit so muscle memory carries over.
function RenameRow({ initialName, setName, onCommit, onCancel }) {
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="group-row group-row-editing">
      <input
        ref={inputRef}
        className="group-row-rename-input"
        value={initialName}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onCommit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        onBlur={onCommit}
        aria-label="Group name"
      />
    </div>
  );
}

function CreateGroupModal({ name, setName, onSubmit, onCancel }) {
  const inputRef = useRef(null);
  const inputId = useId();

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(event) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Create group">
      <form className="modal-card surface create-group-card" onSubmit={onSubmit}>
        <div className="edit-contact-header">
          <h2>New group</h2>
          <button type="button" onClick={onCancel} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <label htmlFor={inputId}>
          Group name
          <input
            ref={inputRef}
            id={inputId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Newsletter subscribers"
            required
          />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={!name.trim()}>
            Create group
          </button>
        </div>
      </form>
    </div>
  );
}
