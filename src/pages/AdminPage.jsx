import { useEffect, useMemo, useState } from 'react';
import {
  Pencil, ScrollText, ShieldCheck, Trash2, UserPlus, Users,
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
import { RolesManager } from '../components/RolesManager';
import { CreateUserModal, EditUserModal } from '../components/UserModals';
import { usePageSectionLabel } from '../components/PageSectionContext';

// Mirrors the TABS list built inside the component. Kept at module scope so
// the section eyebrow can be published before the early return for
// non-admins, which sits above where TABS is defined.
const SECTION_LABELS = {
  team: 'Team members',
  roles: 'Roles & access',
  activity: 'Activity log',
};

export function AdminPage({ notify }) {
  const { user, can } = useAuth();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [logs, setLogs] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [tab, setTab] = useState('team'); // 'team' | 'roles' | 'activity'
  // Topbar already says "Admin"; the eyebrow names which tab is open.
  usePageSectionLabel(SECTION_LABELS[tab]);
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
    getAuditLogs({ limit: 50 }).then(setLogs).catch(() => {});
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="page-stack content-page">
        <section className="surface">
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

  const TABS = [
    { id: 'team', label: 'Team members', icon: Users, count: users.length },
    { id: 'roles', label: 'Roles & access', icon: ShieldCheck, count: roles.length },
    { id: 'activity', label: 'Activity log', icon: ScrollText },
  ];

  return (
    <div className="page-stack content-page admin-page">
      <div className="subtabs" role="tablist" aria-label="Admin sections">
        {TABS.map((item) => {
          const Icon = item.icon;
          const isActive = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`subtab${isActive ? ' is-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <Icon size={16} aria-hidden="true" />
              {item.label}
              {typeof item.count === 'number' && (
                <span className="subtab-count">{item.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'team' && (
        <section className="surface">
          <div className="section-heading">
            <div>
              <h3>Team members</h3>
              <span className="muted">{users.length} {users.length === 1 ? 'member' : 'members'}</span>
            </div>
            <button type="button" className="primary" onClick={() => setCreateOpen(true)}>
              <UserPlus size={14} aria-hidden="true" /> Add user
            </button>
          </div>

          {users.length === 0 ? (
            <p className="empty-state">No users yet.</p>
          ) : (
            <ul className="admin-user-list">
              {users.map((item) => (
                <li key={item.id}>
                  <div className="admin-user-info">
                    <strong>{item.name || item.email}</strong>
                    <span className="muted">{item.email}</span>
                  </div>
                  <span className={`pill ${rolePill(item.role)}`}>{roleName[item.role] || item.role}</span>
                  <div className="admin-user-actions">
                    <button
                      type="button"
                      className="row-action"
                      onClick={() => setEditing(item)}
                      title="Edit user"
                      aria-label={`Edit ${item.email}`}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="row-action row-action-danger"
                      disabled={item.id === user.id}
                      onClick={() => confirmDelete(item)}
                      title={item.id === user.id ? "You can't delete yourself" : 'Delete user'}
                      aria-label={`Delete ${item.email}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'roles' && (
        <RolesManager notify={notify} onRolesChanged={reloadRoles} />
      )}

      {tab === 'activity' && (
        <section className="surface">
          <div className="section-heading">
            <div>
              <h3>Activity log</h3>
              <span className="muted">The most recent changes in this workspace.</span>
            </div>
            <button type="button" onClick={() => getAuditLogs({ limit: 50 }).then(setLogs)}>
              Refresh
            </button>
          </div>
          {logs.length === 0 ? (
            <p className="empty-state">No activity yet.</p>
          ) : (
            <ul className="audit-list">
              {logs.map((log) => (
                <li key={log.id}>
                  <span className="audit-time">{formatTime(log.createdAt)}</span>
                  <span className="audit-user">{log.userEmail || '-'}</span>
                  <span className="audit-action">{log.action}</span>
                  <span className="audit-resource">
                    {log.resource}{log.resourceId ? `:${log.resourceId.slice(0, 8)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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

function rolePill(role) {
  if (role === 'admin') return 'green';
  if (role === 'editor') return 'amber';
  return 'muted';
}

function formatTime(value) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}
