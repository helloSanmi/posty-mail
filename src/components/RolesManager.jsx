import { useEffect, useId, useMemo, useState } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import {
  AREAS,
  IMPLIED_READS,
  effectivePermissions,
  normalizePermissions,
} from '../../shared/permissions.js';
import { Modal } from './Modal';
import {
  createRole, deleteRole, listRoles, updateRole,
} from '../services/brevoApi';
import { ConfirmDialog } from './ConfirmDialog';
import { Loading } from './Spinner';

// Roles & access, as a matrix.
//
// It used to be a tick or a dash per cell, because access was on or off. It
// is a level now — none / view / edit / full — so the cell says which, in a
// word. The grid still answers "who can touch Connections?" by reading down
// a column; it now also answers "and how much?", which is the question that
// had no answer before.
//
// The greyed cells are the interesting ones. A role granted Campaigns can
// read Audience and Email whether or not anyone ticked them, because the
// campaign builder resolves groups to recipients and lists templates. That
// was true before too — it was just invisible, expressed as "reads are open
// to everyone" in a comment in the middle of the server. Here it says
// "View · via Campaigns", so an admin can see the access they are actually
// granting rather than the access the form appears to grant.
const LEVEL_LABEL = {
  none: '-',
  read: 'View',
  write: 'Edit',
  manage: 'Full',
};

// The picker spells "None" out. A dash is fine in a dense grid, where the
// reader is scanning for the cells that are NOT dashes — but as the label on
// a control it is a shrug, and a screen reader says "dash".
const PICKER_LABEL = { ...LEVEL_LABEL, none: 'None' };

// Which granted area is handing this one its implied read. Reversing
// IMPLIED_READS rather than hardcoding the pairs, so adding an implication
// in shared/permissions.js shows up here with no second edit.
function impliedSource(areaKey, direct) {
  const found = Object.entries(IMPLIED_READS).find(
    ([source, targets]) => direct[source] && targets.includes(areaKey),
  );
  if (!found) return null;
  return AREAS.find((a) => a.key === found[0])?.label || found[0];
}

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
        <Loading />
      ) : (
        <div
          className="roles-frame"
          tabIndex={0}
          role="region"
          aria-label="Access by role and area, scrollable"
        >
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
                <RoleRow
                  key={role.id}
                  role={role}
                  onEdit={() => setEditing(role)}
                  onDelete={() => confirmDelete(role)}
                />
              ))}
            </tbody>
          </table>
        </div>
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

function RoleRow({ role, onEdit, onDelete }) {
  // The server already normalises, but a role fetched before a deploy — or a
  // test rendering a raw fixture — can still be a v1 array.
  const direct = useMemo(
    () => normalizePermissions(role.permissions).areas,
    [role.permissions],
  );
  const effective = useMemo(
    () => effectivePermissions(role.permissions),
    [role.permissions],
  );

  return (
    <tr className="sm-row">
      <td>
        <strong>{role.name}</strong>
        {role.locked && (
          <span className="roles-note">Full access, including user &amp; role management</span>
        )}
      </td>
      <td className="sm-num">{role.userCount}</td>
      {AREAS.map((area) => {
        const top = area.levels[area.levels.length - 1];
        const level = role.locked ? top : (effective[area.key] || 'none');
        const implied = !role.locked && !direct[area.key] && level !== 'none'
          ? impliedSource(area.key, direct)
          : null;
        return (
          <td key={area.key} className="roles-cell">
            <span
              className={`roles-level is-${level}${implied ? ' is-implied' : ''}`}
              title={implied ? `View, because this role has ${implied}` : undefined}
            >
              {LEVEL_LABEL[level]}
              {implied && <small className="roles-via">via {implied}</small>}
              <span className="visually-hidden">
                {level === 'none'
                  ? `${role.name} cannot open ${area.label}`
                  : `${role.name} has ${LEVEL_LABEL[level].toLowerCase()} access to ${area.label}${implied ? `, implied by ${implied}` : ''}`}
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
          onClick={onEdit}
          title={role.locked ? "The Admin role can't be edited" : 'Edit role'}
          aria-label={`Edit ${role.name}`}
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="sm-icon-btn is-danger"
          disabled={role.isSystem}
          onClick={onDelete}
          title={role.isSystem ? "Built-in roles can't be deleted" : 'Delete role'}
          aria-label={`Delete ${role.name}`}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}

function RoleModal({ role, onSave, onCancel }) {
  const [name, setName] = useState(role?.name || '');
  const [areas, setAreas] = useState(
    () => ({ ...normalizePermissions(role?.permissions).areas }),
  );
  const [submitting, setSubmitting] = useState(false);
  const nameId = useId();

  // Recomputed as the admin clicks, so the implied reads move in the same
  // gesture that causes them. Ticking Campaigns lights up Audience and Email
  // while the pointer is still there — which is the moment the admin can
  // actually take it in.
  const effective = useMemo(() => effectivePermissions({ v: 2, areas }), [areas]);

  function setLevel(key, level) {
    setAreas((prev) => {
      const next = { ...prev };
      if (level === 'none') delete next[key];
      else next[key] = level;
      return next;
    });
  }

  const valid = name.trim().length > 0;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await onSave({ name: name.trim(), permissions: { v: 2, areas } });
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

      <p className="role-modal-legend muted">What this role can do in each area</p>
      <div className="role-area-grid">
        {AREAS.map((area) => {
          const chosen = areas[area.key] || 'none';
          // Granted somewhere else, and the admin did not choose it here.
          const impliedBy = chosen === 'none' && effective[area.key]
            ? impliedSource(area.key, areas)
            : null;
          return (
            <fieldset key={area.key} className="role-area-option">
              <legend className="role-area-text">
                <strong>{area.label}</strong>
                <small className="muted">
                  {impliedBy
                    ? `View, because this role has ${impliedBy}`
                    : area.description}
                </small>
              </legend>
              <div className="role-level-picker" role="radiogroup" aria-label={area.label}>
                {area.levels.map((level) => (
                  <label
                    key={level}
                    className={`role-level${chosen === level ? ' is-chosen' : ''}`}
                    // `manage` is the rung people misread, so the area says
                    // in its own words what it means — "Send, schedule and
                    // delete" rather than a word that could mean anything.
                    title={level === 'manage' ? area.manageMeans : undefined}
                  >
                    <input
                      type="radio"
                      name={`${area.key}-level`}
                      value={level}
                      checked={chosen === level}
                      onChange={() => setLevel(area.key, level)}
                    />
                    <span>
                      {level === 'none' && impliedBy ? 'View*' : PICKER_LABEL[level]}
                    </span>
                  </label>
                ))}
              </div>
              {area.manageMeans && area.levels.includes('manage') && (
                <p className="role-level-note muted">Full: {area.manageMeans.toLowerCase()}</p>
              )}
            </fieldset>
          );
        })}
      </div>

      <p className="role-modal-foot muted">
        User and role management stays with the built-in Admin role and cannot
        be granted here.
      </p>

      <div className="modal-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={submitting || !valid}>
          {submitting ? 'Saving…' : (role ? 'Save role' : 'Create role')}
        </button>
      </div>
    </Modal>
  );
}
