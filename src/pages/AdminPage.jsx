import { useEffect, useMemo, useState } from 'react';
import {
  Pencil, Plus, Trash2, UserPlus,
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

// Mirrors the TABS list built inside the component. Kept at module scope so
// the section eyebrow can be published before the early return for
// non-admins, which sits above where TABS is defined.
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
  const [tab, setTab] = useState('team'); // 'team' | 'roles' | 'activity'
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
                    <span className="sm-dim sm-trunc">{item.email}</span>
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



