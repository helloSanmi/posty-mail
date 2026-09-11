import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { Modal } from './Modal';
import { PasswordInput } from './PasswordInput';

// Fallback if the roles list hasn't loaded yet — the three built-ins always
// exist. Once AdminPage passes real roles (incl. custom ones) we use those.
const FALLBACK_ROLES = [
  { key: 'admin', name: 'Admin' },
  { key: 'editor', name: 'Editor' },
  { key: 'viewer', name: 'Viewer' },
];

export function CreateUserModal({ roles = [], onCreate, onCancel }) {
  const roleOptions = roles.length ? roles : FALLBACK_ROLES;
  const [draft, setDraft] = useState({ email: '', name: '', password: '', role: 'editor' });
  const [submitting, setSubmitting] = useState(false);
  const emailId = useId();
  const nameId = useId();
  const passwordId = useId();
  const roleId = useId();

  const valid = draft.email && draft.password.length >= 8;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    try {
      await onCreate(draft);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal label="Add user" onClose={onCancel} className="user-modal" as="form" onSubmit={handleSubmit}>
        <div className="edit-contact-header">
          <h2>Add user</h2>
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
              required
              autoComplete="off"
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
          </label>
          <label htmlFor={nameId}>
            Name (optional)
            <input
              id={nameId}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label htmlFor={passwordId}>
            Initial password
            <PasswordInput
              id={passwordId}
              required
              minLength={8}
              autoComplete="new-password"
              value={draft.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
              placeholder="At least 8 characters"
            />
          </label>
          <label htmlFor={roleId}>
            Role
            <select
              id={roleId}
              value={draft.role}
              onChange={(event) => setDraft({ ...draft, role: event.target.value })}
            >
              {roleOptions.map((role) => (
                <option key={role.key} value={role.key}>{role.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={submitting || !valid}>
            {submitting ? 'Creating…' : 'Create user'}
          </button>
        </div>
    </Modal>
  );
}

export function EditUserModal({
  user, roles = [], isSelf, onSave, onResetPassword, onCancel,
}) {
  const roleOptions = roles.length ? roles : FALLBACK_ROLES;
  const [draft, setDraft] = useState({ name: user.name || '', role: user.role });
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const nameId = useId();
  const roleId = useId();
  const passwordId = useId();

  const profileChanged = draft.name !== (user.name || '') || draft.role !== user.role;
  const passwordEntered = newPassword.length > 0;
  const passwordValid = newPassword.length >= 8;
  const passwordError = passwordEntered && !passwordValid;
  const canSave = (profileChanged || passwordValid) && !passwordError;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSave || submitting) return;
    setSubmitting(true);
    try {
      if (profileChanged) await onSave(draft);
      if (passwordValid) await onResetPassword(newPassword);
      onCancel();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      label={`Edit ${user.email}`}
      onClose={onCancel}
      className="user-modal"
      as="form"
      onSubmit={handleSubmit}
    >
        <div className="edit-contact-header">
          <div>
            <h2>Edit user</h2>
            <span className="muted">{user.email}</span>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="edit-contact-grid user-modal-grid">
          <div className="form-field">
            <label htmlFor={nameId}>Name</label>
            <input
              id={nameId}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            {/* Empty hint slot keeps the Name column's bottom edge aligned
                with Role's, which carries the "can't change own role" hint
                when editing yourself. */}
            <small className="muted user-modal-hint" aria-hidden="true">&nbsp;</small>
          </div>
          <div className="form-field">
            <label htmlFor={roleId}>Role</label>
            <select
              id={roleId}
              value={draft.role}
              disabled={isSelf}
              onChange={(event) => setDraft({ ...draft, role: event.target.value })}
            >
              {roleOptions.map((role) => (
                <option key={role.key} value={role.key}>{role.name}</option>
              ))}
              {/* Keep the current role selectable even if it was since deleted,
                  so the select isn't blank on a stale assignment. */}
              {!roleOptions.some((r) => r.key === draft.role) && (
                <option value={draft.role}>{draft.role}</option>
              )}
            </select>
            <small className="muted user-modal-hint">
              {isSelf ? "You can't change your own role." : ' '}
            </small>
          </div>
        </div>

        <div className="form-field user-modal-password-field">
          <label htmlFor={passwordId}>
            New password <span className="muted">(leave blank to keep current)</span>
          </label>
          <PasswordInput
            id={passwordId}
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="At least 8 characters"
            aria-invalid={passwordError}
          />
          {passwordError && (
            <small className="field-error" role="alert">
              Password must be at least 8 characters.
            </small>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={submitting || !canSave}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
    </Modal>
  );
}
