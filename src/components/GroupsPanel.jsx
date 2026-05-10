import { useEffect, useId, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { createGroup, deleteGroup, getGroups } from '../services/brevoApi';
import { ConfirmDialog } from './ConfirmDialog';

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
            <span aria-hidden="true" />
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
        {groups.map((group) => {
          const active = viewingGroupId === group.id;
          return (
            <li key={group.id}>
              <button
                type="button"
                className={`group-row${active ? ' is-active' : ''}`}
                onClick={() => onView?.(group.id)}
                aria-pressed={active}
                title={group.name}
              >
                <span className="group-name">{group.name}</span>
                <span className="group-count">{(group.contactEmails || []).length}</span>
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
                >
                  <Trash2 size={12} aria-hidden="true" />
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
