import { useEffect, useId, useRef, useState } from 'react';
import {
  Lock, Pencil, Plus, ShieldCheck, Trash2, X,
} from 'lucide-react';
import { AREAS } from '../../shared/permissions.js';
import {
  createRole, deleteRole, listRoles, updateRole,
} from '../services/brevoApi';
import { ConfirmDialog } from './ConfirmDialog';

const AREA_LABEL = Object.fromEntries(AREAS.map((a) => [a.key, a.label]));

// Roles & access. An admin creates custom roles and toggles which app areas
// each can reach. The built-in Admin role is locked (full access); Editor and
// Viewer are editable presets. Assign roles to people in Team members above.
export function RolesManager({ notify, onRolesChanged }) {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // role object or { create:true }
  const [confirm, setConfirm] = useState(null);

  function reload() {
    return listRoles()
      .then((data) => setRoles(data))
      .catch(() => notify?.('Could not load roles', 'error'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    <section className="surface">
      <div className="section-heading">
        <div>
          <h2>
            <ShieldCheck size={16} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Roles &amp; access
          </h2>
          <span className="muted">What each role can open. Assign roles in Team members.</span>
        </div>
        <button type="button" className="primary" onClick={() => setEditing({ create: true })}>
          <Plus size={14} aria-hidden="true" /> New role
        </button>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="roles-list">
          {roles.map((role) => (
            <li key={role.id} className="role-row">
              <div className="role-row-main">
                <div className="role-row-head">
                  <strong>{role.name}</strong>
                  {role.locked && (
                    <span className="role-lock" title="Full access — can't be changed">
                      <Lock size={12} aria-hidden="true" /> Full access
                    </span>
                  )}
                  <span className="muted role-usercount">
                    {role.userCount} {role.userCount === 1 ? 'member' : 'members'}
                  </span>
                </div>
                <div className="role-areas">
                  {role.locked ? (
                    <span className="muted">Everything, including user &amp; role management.</span>
                  ) : role.permissions.length === 0 ? (
                    <span className="muted">No access yet — Home only.</span>
                  ) : (
                    role.permissions.map((key) => (
                      <span key={key} className="pill role-area-pill">{AREA_LABEL[key] || key}</span>
                    ))
                  )}
                </div>
              </div>
              <div className="role-row-actions">
                <button
                  type="button"
                  className="row-action"
                  disabled={role.locked}
                  onClick={() => setEditing(role)}
                  title={role.locked ? "The Admin role can't be edited" : 'Edit role'}
                  aria-label={`Edit ${role.name}`}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="row-action row-action-danger"
                  disabled={role.isSystem}
                  onClick={() => confirmDelete(role)}
                  title={role.isSystem ? "Built-in roles can't be deleted" : 'Delete role'}
                  aria-label={`Delete ${role.name}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
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
    </section>
  );
}

function RoleModal({ role, onSave, onCancel }) {
  const [name, setName] = useState(role?.name || '');
  const [permissions, setPermissions] = useState(() => new Set(role?.permissions || []));
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef(null);
  const nameId = useId();

  useEffect(() => {
    nameRef.current?.focus();
    function onKey(event) { if (event.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

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
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={role ? `Edit ${role.name}` : 'New role'}>
      <form className="modal-card surface role-modal" onSubmit={handleSubmit}>
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
            ref={nameRef}
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
      </form>
    </div>
  );
}
