import { useId, useState } from 'react';
import { KeyRound, Pencil } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { AREAS, hasLevel } from '../../shared/permissions.js';
import { changeOwnPassword, updateProfile } from '../services/authApi';
import { setAuthHeader } from '../services/apiClient';
import { PasswordInput } from '../components/PasswordInput';
import { SlideOver } from '../components/SlideOver';
import { prettyRole } from '../utils/roleName';

// Your own profile.
//
// READ FIRST, EDIT ON PURPOSE. The page shows what you are; it does not open
// as a form. The first version had every field permanently editable and the
// three password boxes sitting open underneath them, which gets two things
// wrong at once: a page you came to look at looks like a form you are
// expected to fill in, and "change my password" — a deliberate, occasional,
// slightly serious act — was presented as ambient furniture you might wander
// into. Nobody arrives here to change their password by accident.
//
// So: a summary, and two explicit actions. Each opens a right-edge panel,
// which keeps the record you are editing visible behind it and makes the
// task read as separate from the page rather than as the page's content.
const LEVEL_WORD = {
  read: 'View',
  write: 'View and edit',
  manage: 'Full access',
};

function grantedLevel(permissions, areaKey) {
  if (hasLevel(permissions, areaKey, 'manage')) return 'manage';
  if (hasLevel(permissions, areaKey, 'write')) return 'write';
  if (hasLevel(permissions, areaKey, 'read')) return 'read';
  return null;
}

// "Not changed yet" is deliberate, and deliberately not a guess. The column
// is null for rows that predate it AND for anyone still on the password an
// admin set for them — and the second group is exactly who should be nudged.
// Backfilling from createdAt would have stated a date nobody can vouch for,
// on a field people use to decide whether a password is stale.
function lastChanged(iso) {
  if (!iso) return 'Not changed yet';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Not changed yet';
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return 'Changed today';
  if (days === 1) return 'Changed yesterday';
  if (days < 30) return `Changed ${days} days ago`;
  return `Changed ${then.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function initials(user) {
  const source = String(user?.name || user?.email || '').trim();
  const local = source.split('@')[0];
  const parts = local.split(/[\s._-]+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]).join('') || local[0] || '?').toUpperCase();
}

export function ProfilePage({ notify }) {
  const { user, applyUser } = useAuth();
  // RequireAuth means there is always a user by the time this renders; the
  // guard is for the frame between a sign-out and the redirect landing.
  if (!user) return null;
  return <Profile user={user} applyUser={applyUser} notify={notify} />;
}

function Profile({ user, applyUser, notify }) {
  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const areas = AREAS
    .map((area) => ({ ...area, level: grantedLevel(user.permissions, area.key) }))
    .filter((area) => area.level);

  return (
    <div className="page-stack content-page profile-page">
      <div className="profile-grid">
        <div className="profile-column">
          <section className="sm-card profile-section">
            <div className="profile-head">
              <span className="sh-avatar sh-avatar-lg" aria-hidden="true">{initials(user)}</span>
              <div className="profile-identity">
                <strong>{user.name || user.email}</strong>
                <span className="muted">{user.email}</span>
              </div>
              <button
                type="button"
                className="sm-btn"
                onClick={() => setEditing(true)}
              >
                <Pencil size={14} aria-hidden="true" /> Edit
              </button>
            </div>

            <dl className="profile-facts">
              <div>
                <dt>Name</dt>
                <dd>{user.name || <span className="muted">Not set</span>}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{user.location || <span className="muted">Not set</span>}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{prettyRole(user.role)}</dd>
              </div>
            </dl>

            <p className="profile-locked muted">
              {/* Said rather than left to be discovered — someone hunting for
                  a field that is not there concludes the app is unfinished. */}
              Your email address and role are set by an admin.
            </p>
          </section>

          <section className="sm-card profile-section">
            <div className="profile-head">
              <div className="profile-identity">
                <strong>Password</strong>
                <span className="muted" title={user.passwordChangedAt || undefined}>
                  {lastChanged(user.passwordChangedAt)}
                </span>
              </div>
              <button
                type="button"
                className="sm-btn"
                onClick={() => setChangingPassword(true)}
              >
                <KeyRound size={14} aria-hidden="true" /> Change
              </button>
            </div>
          </section>
        </div>

        <section className="sm-card profile-section profile-access">
          <strong className="profile-subhead">What your role can reach</strong>
          {areas.length === 0 ? (
            <p className="empty-state compact">
              This role has no areas granted yet. An admin can change that
              under Access.
            </p>
          ) : (
            <ul className="profile-areas">
              {areas.map((area) => (
                <li key={area.key}>
                  <span className="profile-area-name">{area.label}</span>
                  <span className={`profile-area-level is-${area.level}`}>
                    {LEVEL_WORD[area.level]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {editing && (
        <EditDetailsPanel
          user={user}
          notify={notify}
          onSaved={(next) => { applyUser(next); setEditing(false); }}
          onClose={() => setEditing(false)}
        />
      )}

      {changingPassword && (
        <ChangePasswordPanel
          notify={notify}
          onDone={(next) => { if (next) applyUser(next); setChangingPassword(false); }}
          onClose={() => setChangingPassword(false)}
        />
      )}
    </div>
  );
}

function EditDetailsPanel({
  user, notify, onSaved, onClose,
}) {
  const [name, setName] = useState(user.name || '');
  const [location, setLocation] = useState(user.location || '');
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  const locationId = useId();

  const dirty = name !== (user.name || '') || location !== (user.location || '');

  async function submit(event) {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const result = await updateProfile({ name, location });
      notify?.('Profile updated');
      onSaved(result.user);
    } catch (error) {
      notify?.(error.response?.data?.error || 'Could not save your profile', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      label="Edit your details"
      onClose={onClose}
      as="form"
      onSubmit={submit}
      footer={(
        <>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    >
      <label htmlFor={nameId} className="profile-field">
        Name
        <input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          placeholder="Your name"
        />
      </label>

      <label htmlFor={locationId} className="profile-field">
        <span className="profile-label-row">
          Location
          <span className="profile-optional">optional</span>
        </span>
        <input
          id={locationId}
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          maxLength={80}
          placeholder="Lagos, Remote, …"
        />
      </label>
    </SlideOver>
  );
}

function ChangePasswordPanel({ notify, onDone, onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const currentId = useId();
  const nextId = useId();
  const confirmId = useId();
  const othersId = useId();

  // Checked here as well as on the server, because the server compares a
  // hash and only ever sees one of the two — it cannot give this answer.
  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = current.length > 0 && next.length >= 8 && next === confirm && !saving;

  async function submit(event) {
    event.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError('');
    try {
      const result = await changeOwnPassword(current, next, signOutOthers);
      // The server mints a fresh token on success. Adopting it keeps the tab
      // from running on a credential issued before the change.
      if (result?.token) {
        setAuthHeader(result.token);
        window.localStorage.setItem('campaign-suite-token', result.token);
      }
      notify?.(result?.signedOutOthers
        ? 'Password changed. Your other devices have been signed out.'
        : 'Password changed');
      // The card behind this panel says when the password last changed, and
      // it reads from `user`. Without re-reading, a successful change leaves
      // it saying "Not changed yet" — which is the one moment someone is
      // looking at that line to confirm the thing they just did worked.
      onDone(result?.user);
    } catch (requestError) {
      // In the panel, not as a toast: it is a correction to a field still on
      // screen, and a toast that disappears takes the reason with it.
      setError(requestError.response?.data?.error || 'Could not change your password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      label="Change password"
      onClose={onClose}
      as="form"
      onSubmit={submit}
      footer={(
        <>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!ready}>
            {saving ? 'Changing…' : 'Change password'}
          </button>
        </>
      )}
    >
      <label htmlFor={currentId} className="profile-field">
        Current password
        <PasswordInput
          id={currentId}
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
        />
      </label>

      <label htmlFor={nextId} className="profile-field">
        New password
        <PasswordInput
          id={nextId}
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
          minLength={8}
        />
        <small className="muted">At least 8 characters.</small>
      </label>

      <label htmlFor={confirmId} className="profile-field">
        Confirm new password
        <PasswordInput
          id={confirmId}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="new-password"
        />
        {mismatch && (
          <small className="profile-error-inline" role="alert">These do not match.</small>
        )}
      </label>

      {/* An action, not a disclaimer. The panel used to state that other
          devices stayed signed in, which told someone worried about a
          compromise exactly the thing they did not want to hear and gave
          them nowhere to go with it. */}
      <label className="checkbox-line" htmlFor={othersId}>
        <input
          id={othersId}
          type="checkbox"
          checked={signOutOthers}
          onChange={(event) => setSignOutOthers(event.target.checked)}
        />
        Sign out my other devices
      </label>

      {error && <p className="profile-error" role="alert">{error}</p>}
    </SlideOver>
  );
}
