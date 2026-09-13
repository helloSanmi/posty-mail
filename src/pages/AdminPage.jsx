import { useEffect, useMemo, useState } from 'react';
import {
  MapPin, Pencil, Plus, Trash2, UserPlus,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  createAdminUser,
  deleteAdminUser,
  getAuditLogs,
  listAdminUsers,
  listRoles,
  resetUserPassword,
  updateAdminUser,
} from '../services/brevoApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ActivityLog } from '../components/ActivityLog';
import { RolesManager } from '../components/RolesManager';
import { CreateUserModal, EditUserModal } from '../components/UserModals';
import { useViewState } from '../hooks/useViewState';

export function AdminPage({ notify }) {
  const { user, can } = useAuth();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [logs, setLogs] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  // Owned here because the button that starts it sits in the card head, and
  // the head belongs to this page rather than to RolesManager.
  const [creatingRole, setCreatingRole] = useState(false);
  const [editing, setEditing] = useState(null);
  // In the URL, not in useState. Refreshing on "Roles & access" used to drop
  // you back on Team members, and there was no way to send anyone a link to
  // the roles matrix — /admin always opened on Team.
  const [view, setView] = useViewState({
    tab: { fallback: 'team', allow: ['team', 'roles', 'activity'] },
  });
  const { tab } = view;
  const setTab = (id) => setView({ tab: id });
  // Topbar already says "Admin"; the eyebrow names which tab is open.
  // No topbar eyebrow. It named the active section — and the section is
  // already named, in the tab strip directly below it, where the active
  // one is highlighted. Two labels for one thing, a centimetre apart.
  const isAdmin = can('admin');

  const roleName = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.key, r.name])),
    [roles],
  );

  function reloadRoles() {
    return listRoles().then(setRoles).catch(() => {});
  }

  useEffect(() => {
    if (!isAdmin) return;
    listAdminUsers().then(setUsers).catch(() => {});
    reloadRoles();
    getAuditLogs({ limit: 200 }).then(setLogs).catch(() => {});
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="page-stack content-page">
        <section className="sm-card">
          <p className="empty-state">You need an admin role to view this page.</p>
        </section>
      </div>
    );
  }

  async function handleCreate(draft) {
    try {
      const created = await createAdminUser(draft);
      setUsers((prev) => [...prev, created]);
      setCreateOpen(false);
      notify('User created');
    } catch (error) {
      notify(error.response?.data?.error || 'Could not create user', 'error');
    }
  }

  async function handleSaveProfile(draft) {
    try {
      const updated = await updateAdminUser(editing.id, draft);
      setUsers((prev) => prev.map((item) => (item.id === editing.id ? updated : item)));
      setEditing(updated);
      notify('User updated');
    } catch (error) {
      notify(error.response?.data?.error || 'Could not update user', 'error');
    }
  }

  async function handleResetPassword(password) {
    try {
      await resetUserPassword(editing.id, password);
      notify('Password reset');
    } catch (error) {
      notify(error.response?.data?.error || 'Could not reset password', 'error');
    }
  }

  function confirmDelete(target) {
    setConfirm({
      title: `Delete ${target.email}?`,
      message: 'This permanently removes the account.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await deleteAdminUser(target.id);
          setUsers((prev) => prev.filter((item) => item.id !== target.id));
          notify('User deleted');
        } catch (error) {
          notify(error.response?.data?.error || 'Delete failed', 'error');
        }
      },
    });
  }

  // The tab names the view, so the per-section h3 and its restated count are
  // gone: the count rides on the tab and the section's one action joins the
  // tab row rather than starting a second control row beneath it.
  const TABS = [
    { id: 'team', label: 'Team members', count: users.length },
    { id: 'roles', label: 'Roles & access', count: roles.length },
    { id: 'activity', label: 'Activity log' },
  ];

  return (
    <div className="page-stack content-page admin-page">
      <section className="sm-card">
        <div className="sm-card-head">
          <div className="sm-tabs" role="tablist" aria-label="Admin sections">
            {TABS.map((item) => {
              const isActive = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`sm-tab${isActive ? ' is-active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                  {typeof item.count === 'number' && (
                    <span className="sm-tab-n">{item.count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* The head's right slot carries the open tab's one action. Roles
              has none here because RolesManager owns its own New role
              button along with the modal it opens. */}
          {tab === 'team' && (
            <button type="button" className="sm-btn sm-btn-primary" onClick={() => setCreateOpen(true)}>
              <UserPlus size={14} aria-hidden="true" /> Add user
            </button>
          )}
          {tab === 'roles' && (
            <button
              type="button"
              className="sm-btn sm-btn-primary"
              onClick={() => setCreatingRole(true)}
            >
              <Plus size={14} aria-hidden="true" /> New role
            </button>
          )}
        </div>

        {tab === 'team' && (
          users.length === 0 ? (
            <p className="empty-state">No users yet.</p>
          ) : (
            <ul className="sm-rows">
              {users.map((item) => (
                <li key={item.id} className="sm-rowitem">
                  <span className="sm-avatar" aria-hidden="true">
                    {initials(item.name || item.email)}
                  </span>
                  <span className="sm-rowtext">
                    <span className="sm-rowname">
                      {item.name || item.email}
                      {item.id === user.id && <span className="sm-chip">you</span>}
                    </span>
                    {/* The second line carries the email and the location.
                        The email only when there IS a name, because the line
                        above falls back to the email when there is not — and
                        printing it twice, one under the other, reads as a
                        rendering fault rather than as a person who has not
                        set a name.

                        Location rides on this line rather than taking a
                        column of its own: it is optional, so a column would
                        be mostly empty, and an empty column reads as missing
                        data rather than as a field nobody filled in. On the
                        line, absent is simply absent — and when neither part
                        is present the line does not render at all, instead
                        of leaving a blank row of height under the name. */}
                    {(item.name || item.location) && (
                      <span className="sm-dim sm-trunc">
                        {item.name && item.email}
                        {item.name && item.location && (
                          <span className="sm-sep" aria-hidden="true">·</span>
                        )}
                        {item.location && (
                          <span className="sm-place">
                            <MapPin size={11} aria-hidden="true" />
                            {item.location}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="sm-role">{roleName[item.role] || item.role}</span>
                  <span className="sm-rowactions">
                    <button
                      type="button"
                      className="sm-icon-btn"
                      onClick={() => setEditing(item)}
                      title="Edit user"
                      aria-label={`Edit ${item.email}`}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="sm-icon-btn is-danger"
                      disabled={item.id === user.id}
                      onClick={() => confirmDelete(item)}
                      title={item.id === user.id ? "You can't delete yourself" : 'Delete user'}
                      aria-label={`Delete ${item.email}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )
        )}

        {tab === 'roles' && (
          <RolesManager
            notify={notify}
            onRolesChanged={reloadRoles}
            creating={creatingRole}
            onCreatingChange={setCreatingRole}
          />
        )}

        {tab === 'activity' && (
          <ActivityLog
            logs={logs}
            onRefresh={() => getAuditLogs({ limit: 200 }).then(setLogs)}
          />
        )}
      </section>

      {createOpen && (
        <CreateUserModal
          roles={roles}
          onCreate={handleCreate}
          onCancel={() => setCreateOpen(false)}
        />
      )}

      {editing && (
        <EditUserModal
          user={editing}
          roles={roles}
          isSelf={editing.id === user.id}
          onSave={handleSaveProfile}
          onResetPassword={handleResetPassword}
          onCancel={() => setEditing(null)}
        />
      )}

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
    </div>
  );
}

// Initials for the row avatar. Real users may have no name, so the email is
// the fallback and a single-token value yields one letter.
function initials(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}



