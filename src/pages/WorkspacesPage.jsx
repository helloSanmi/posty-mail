import { useEffect, useState } from 'react';
import { Building2, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { listWorkspaces, deleteWorkspace } from '../services/brevoApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Loading } from '../components/Spinner';

// Install-level super-admin view: every workspace on the install with its
// headline counts, plus the ability to delete one (cascade-wipes its data).
// Gated client-side on user.isSuperAdmin; the server gates again via
// requireSuperAdmin so this page can't be reached by tampering.
//
// The audit's note here was the opposite of everywhere else: under-structure,
// not clutter. Six columns spent ~270px on three single-digit numbers, each
// with an icon AND an uppercase label, and below 760px the header row vanished
// and the values stacked as bare unlabelled lines. The three counts are now one
// cell with inline labels, which survives the narrow breakpoint.
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
        <section className="sm-card">
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
      <section className="sm-card">
        <div className="sm-card-head">
          <h2>
            <Building2 size={15} aria-hidden="true" />
            {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'} on this install
          </h2>
        </div>

        {loading ? (
          <Loading />
        ) : workspaces.length === 0 ? (
          <p className="empty-state">No workspaces yet.</p>
        ) : (
          <ul className="sm-rows">
            {workspaces.map((ws) => {
              const isCurrent = ws.id === user?.accountId;
              const isDefault = ws.id === 'default';
              return (
                <li className="sm-rowitem sm-ws" key={ws.id}>
                  <span className="sm-rowtext">
                    <span className="sm-rowname">
                      {ws.name}
                      {isDefault && <span className="sm-chip">default</span>}
                      {isCurrent && <span className="sm-chip is-accent">you</span>}
                    </span>
                    <span className="sm-dim">{ws.senderEmail || '—'}</span>
                  </span>
                  {/* Three columns of one number each became one cell. The
                      labels are inline, so they survive the narrow breakpoint
                      that used to strip the header row and leave bare digits. */}
                  <span className="sm-counts">
                    <span><b>{ws.users}</b> user{ws.users === 1 ? '' : 's'}</span>
                    <span><b>{Number(ws.contacts || 0).toLocaleString()}</b> contacts</span>
                    <span><b>{ws.campaigns}</b> campaigns</span>
                  </span>
                  {/* Absent, not disabled, on the default workspace and the one
                      you're signed into — the server enforces this too — but the
                      column keeps its width so the right edge does not go ragged
                      down the list. */}
                  <span className="sm-rowactions">
                    {!isDefault && !isCurrent && (
                      <button
                        type="button"
                        className="sm-icon-btn is-danger"
                        onClick={() => confirmDelete(ws)}
                        title="Delete workspace"
                        aria-label={`Delete ${ws.name}`}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
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
