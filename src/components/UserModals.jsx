import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';

const ROLES = ['admin', 'editor', 'viewer'];

export function CreateUserModal({ onCreate, onCancel }) {
  const [draft, setDraft] = useState({ email: '', name: '', password: '', role: 'editor' });
  const [submitting, setSubmitting] = useState(false);
  const cancelRef = useRef(null);
  const emailId = useId();
  const nameId = useId();
  const passwordId = useId();
  const roleId = useId();

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(event) { if (event.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

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
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add user">
      <form className="modal-card surface user-modal" onSubmit={handleSubmit}>
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
            <input
              id={passwordId}
              type="password"
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
              {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
        </div>

        <div className="modal-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={submitting || !valid}>
            {submitting ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function EditUserModal({ user, isSelf, onSave, onResetPassword, onCancel }) {
  const [draft, setDraft] = useState({ name: user.name || '', role: user.role });
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const cancelRef = useRef(null);
  const nameId = useId();
  const roleId = useId();
  const passwordId = useId();

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(event) { if (event.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

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
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Edit ${user.email}`}>
      <form className="modal-card surface user-modal" onSubmit={handleSubmit}>
        <div className="edit-contact-header">
          <div>
            <h2>Edit user</h2>
            <span className="muted">{user.email}</span>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="edit-contact-grid">
          <label htmlFor={nameId}>
            Name
            <input
              id={nameId}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label htmlFor={roleId}>
            Role
            <select
              id={roleId}
              value={draft.role}
              disabled={isSelf}
              onChange={(event) => setDraft({ ...draft, role: event.target.value })}
            >
              {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
            {isSelf && <small className="muted">You can&apos;t change your own role.</small>}
          </label>
        </div>

        <label htmlFor={passwordId} className="user-modal-password-field">
          New password
          <span className="muted"> · leave blank to keep current</span>
          <input
            id={passwordId}
            type="password"
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
        </label>

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
