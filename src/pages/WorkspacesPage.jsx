import { useEffect, useState } from 'react';
import { Building2, Trash2, Users, Mail, Inbox } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { listWorkspaces, deleteWorkspace } from '../services/brevoApi';
import { ConfirmDialog } from '../components/ConfirmDialog';

// Install-level super-admin view: every workspace on the install with its
// headline counts, plus the ability to delete one (cascade-wipes its data).
// Gated client-side on user.isSuperAdmin; the server gates again via
// requireSuperAdmin so this page can't be reached by tampering.
export function WorkspacesPage({ notify }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(null);
  const isSuperAdmin = Boolean(user?.isSuperAdmin);

  function refresh() {
    setLoading(true);
    listWorkspaces()
      .then(setWorkspaces)
      .catch(() => setWorkspaces([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!isSuperAdmin) return;
    refresh();
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return (
      <div className="page-stack content-page">
        <section className="surface">
          <p className="empty-state">
            This page is for install super-admins only.
          </p>
        </section>
      </div>
    );
  }

  function confirmDelete(workspace) {
    setConfirm({
      title: `Delete "${workspace.name}"?`,
      message: `This permanently deletes the workspace and ALL of its data — `
        + `${workspace.contacts} contacts, ${workspace.campaigns} campaigns, `
        + `${workspace.users} user${workspace.users === 1 ? '' : 's'}. This cannot be undone.`,
      confirmLabel: 'Delete workspace',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await deleteWorkspace(workspace.id);
          notify?.(`Workspace "${workspace.name}" deleted`);
          refresh();
        } catch (error) {
          notify?.(error.response?.data?.error || 'Could not delete workspace', 'error');
        }
      },
    });
  }

  return (
    <div className="page-stack content-page">
      <section className="surface">
        <div className="section-heading">
          <h2 className="section-heading-quiet">
            <Building2 size={16} aria-hidden="true" />
            {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'} on this install
          </h2>
        </div>

        {loading ? (
          <p className="empty-state">Loading…</p>
        ) : workspaces.length === 0 ? (
          <p className="empty-state">No workspaces yet.</p>
        ) : (
          <div className="workspaces-table">
            <div className="workspaces-head">
              <span>Workspace</span>
              <span>Sender</span>
              <span><Users size={13} aria-hidden="true" /> Users</span>
              <span><Mail size={13} aria-hidden="true" /> Contacts</span>
              <span><Inbox size={13} aria-hidden="true" /> Campaigns</span>
              <span aria-hidden="true" />
            </div>
            {workspaces.map((ws) => {
              const isCurrent = ws.id === user?.accountId;
              const isDefault = ws.id === 'default';
              return (
                <div className="workspaces-row" key={ws.id}>
                  <span className="workspaces-name">
                    <strong>{ws.name}</strong>
                    {isDefault && <span className="pill muted">default</span>}
                    {isCurrent && <span className="pill blue">you</span>}
                  </span>
                  <span className="muted">{ws.senderEmail || '—'}</span>
                  <span>{ws.users}</span>
                  <span>{ws.contacts}</span>
                  <span>{ws.campaigns}</span>
                  <span className="workspaces-actions">
                    {/* Default + the workspace you're signed into can't be
                        deleted — the server enforces this too. */}
                    {!isDefault && !isCurrent && (
                      <button
                        type="button"
                        className="row-action row-action-danger"
                        onClick={() => confirmDelete(ws)}
                        title="Delete workspace"
                        aria-label={`Delete ${ws.name}`}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

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
