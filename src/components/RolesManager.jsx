import { useEffect, useId, useState } from 'react';
import {
  Check, Minus, Pencil, Trash2, X,
} from 'lucide-react';
import { AREAS } from '../../shared/permissions.js';
import { Modal } from './Modal';
import {
  createRole, deleteRole, listRoles, updateRole,
} from '../services/brevoApi';
import { ConfirmDialog } from './ConfirmDialog';

// Roles & access, as a matrix.
//
// It used to be a stack of rows, each carrying a wall of permission pills —
// up to six per role, wrapping. That shows what ONE role can reach and makes
// the actual question ("who can touch Connections?") a reading exercise
// across every row. A role x area grid answers it by looking down a column,
// and it is the same width whatever the answer is.
//
// It also rendered as its own card BELOW the admin card, which left the
// Roles tab showing an empty card with a tab strip and then a second box
// repeating the tab's name as a heading. It is content inside that card now,
// like Team members and Activity, and the New role button sits in the card
// head where the other tabs' actions sit.
export function RolesManager({
  notify, onRolesChanged, creating, onCreatingChange,
}) {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditingState] = useState(null); // role object or { create:true }
  // `creating` is owned by AdminPage, because the button that starts it
  // lives in the card head up there. Editing is ours — it starts from a row.
  const setEditing = (next) => {
    setEditingState(next);
    if (!next?.create) onCreatingChange?.(false);
  };
  const [confirm, setConfirm] = useState(null);

  function reload() {
    return listRoles()
      .then((data) => setRoles(data))
      .catch(() => notify?.('Could not load roles', 'error'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (creating) setEditingState({ create: true });
  }, [creating]);

  async function handleSave(draft) {
    try {
      if (editing?.create) {
        await createRole({ name: draft.name, permissions: draft.permissions });
        notify?.(`Role "${draft.name}" created`);
      } else {
        await updateRole(editing.id, { name: draft.name, permissions: draft.permissions });
        notify?.('Role updated');
      }
      setEditing(null);
      onCreatingChange?.(false);
      await reload();
      onRolesChanged?.();
    } catch (error) {
      notify?.(error.response?.data?.error || 'Could not save role', 'error');
    }
  }

  function confirmDelete(role) {
    setConfirm({
      title: `Delete role "${role.name}"?`,
      message: role.userCount > 0
        ? `${role.userCount} ${role.userCount === 1 ? 'person is' : 'people are'} assigned this role. Reassign them first.`
        : 'This role will be removed. People can no longer be assigned to it.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await deleteRole(role.id);
          notify?.('Role deleted');
          await reload();
          onRolesChanged?.();
        } catch (error) {
          notify?.(error.response?.data?.error || 'Could not delete role', 'error');
        }
      },
    });
  }

  return (
    <>
      {loading ? (
        <p className="status-line">Loading…</p>
      ) : (
        <table className="sm-table roles-matrix">
          <thead>
            <tr>
              <th>Role</th>
              <th className="sm-num">People</th>
              {AREAS.map((area) => (
                <th key={area.key} className="roles-area-col" title={area.description}>
                  {area.label}
                </th>
              ))}
              <th><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id} className="sm-row">
                <td>
                  <strong>{role.name}</strong>
                  {role.locked && (
                    <span className="roles-note">Full access, including user &amp; role management</span>
                  )}
                </td>
                <td className="sm-num">{role.userCount}</td>
                {AREAS.map((area) => {
                  const granted = role.locked || role.permissions.includes(area.key);
                  return (
                    <td key={area.key} className="roles-cell">
                      {/* The icon is decorative; the cell carries the
                          answer as text for anything not looking at it. */}
                      <span className={`roles-mark${granted ? ' is-on' : ''}`}>
                        {granted
                          ? <Check size={14} aria-hidden="true" />
                          : <Minus size={14} aria-hidden="true" />}
                        <span className="visually-hidden">
                          {`${role.name} ${granted ? 'can' : 'cannot'} open ${area.label}`}
                        </span>
                      </span>
                    </td>
                  );
                })}
                <td className="roles-actions">
                  <button
                    type="button"
                    className="sm-icon-btn"
                    disabled={role.locked}
                    onClick={() => setEditing(role)}
                    title={role.locked ? "The Admin role can't be edited" : 'Edit role'}
                    aria-label={`Edit ${role.name}`}
                  >
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="sm-icon-btn is-danger"
                    disabled={role.isSystem}
                    onClick={() => confirmDelete(role)}
                    title={role.isSystem ? "Built-in roles can't be deleted" : 'Delete role'}
                    aria-label={`Delete ${role.name}`}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <RoleModal
          role={editing.create ? null : editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          {...confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => { await confirm.onConfirm(); setConfirm(null); }}
        />
      )}
    </>
  );
}

function RoleModal({ role, onSave, onCancel }) {
  const [name, setName] = useState(role?.name || '');
  const [permissions, setPermissions] = useState(() => new Set(role?.permissions || []));
  const [submitting, setSubmitting] = useState(false);
  const nameId = useId();

  function toggle(key) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const valid = name.trim().length > 0;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await onSave({ name: name.trim(), permissions: [...permissions] });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      label={role ? `Edit ${role.name}` : 'New role'}
      onClose={onCancel}
      className="role-modal"
      as="form"
      onSubmit={handleSubmit}
    >
        <div className="edit-contact-header">
          <h2>{role ? 'Edit role' : 'New role'}</h2>
          <button type="button" onClick={onCancel} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <label htmlFor={nameId} className="role-modal-name">
          Role name
          <input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Campaign manager"
            maxLength={60}
          />
        </label>

        <p className="role-modal-legend muted">Areas this role can open</p>
        <div className="role-area-grid">
          {AREAS.map((area) => {
            const checked = permissions.has(area.key);
            return (
              <label key={area.key} className={`role-area-option${checked ? ' is-checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(area.key)}
                />
                <span className="role-area-text">
                  <strong>{area.label}</strong>
                  <small className="muted">{area.description}</small>
                </span>
              </label>
            );
          })}
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={submitting || !valid}>
            {submitting ? 'Saving…' : (role ? 'Save role' : 'Create role')}
          </button>
        </div>
    </Modal>
  );
}
