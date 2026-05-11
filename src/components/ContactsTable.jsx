import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FolderMinus, FolderPlus, Pencil, Trash2, X } from 'lucide-react';
import { countryName } from '../data/countries';
import { complianceIssues, validateContacts } from '../../shared/campaignUtils.js';
import {
  bulkDeleteContacts,
  deleteContact,
  downloadContactsCsv,
  getGroupContacts,
  getGroups,
  getSavedContacts,
  patchGroupMembers,
  updateContact,
} from '../services/brevoApi';
import { ContactEditModal } from './ContactEditModal';
import { ConfirmDialog } from './ConfirmDialog';
import { SkeletonList } from './Skeleton';

// 40-per-page is the sweet spot for the "tick all visible → bulk add to a
// group" workflow: selecting a screenful at a time without endless scrolling.
const PAGE_SIZE = 40;

export function ContactsTable({
  notify,
  groupsRefreshTick = 0,
  onGroupsChange,
  viewingGroupId = null,
  onClearGroupView,
  onTotalChange,
}) {
  const [filter, setFilter] = useState({ search: '', region: '', consent: '', excludeUnsubscribed: false });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], total: 0, totalPages: 1 });
  const [selected, setSelected] = useState(new Set());
  const [groups, setGroups] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editingEmail, setEditingEmail] = useState('');
  const [editContact, setEditContact] = useState(null);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const groupMenuRef = useRef(null);

  useEffect(() => {
    if (!groupMenuOpen) return undefined;
    function handleOutside(event) {
      if (!groupMenuRef.current?.contains(event.target)) {
        setGroupMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [groupMenuOpen]);

  const params = useMemo(() => ({
    ...filter,
    excludeUnsubscribed: filter.excludeUnsubscribed || undefined,
    region: filter.region || undefined,
    consent: filter.consent || undefined,
    search: filter.search || undefined,
    page,
    pageSize: PAGE_SIZE,
  }), [filter, page]);

  async function refresh() {
    setLoading(true);
    setLoadError('');
    try {
      if (viewingGroupId) {
        // The group endpoint returns the full member list; slice client-side
        // so the same 40-per-page UX applies whether the user is browsing all
        // contacts or a specific group.
        const rows = await getGroupContacts(viewingGroupId);
        const total = rows.length;
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        const safePage = Math.min(Math.max(page, 1), totalPages);
        const start = (safePage - 1) * PAGE_SIZE;
        setData({
          rows: rows.slice(start, start + PAGE_SIZE),
          total,
          totalPages,
          page: safePage,
        });
      } else {
        const result = await getSavedContacts(params);
        if (Array.isArray(result)) {
          setData({
            rows: result.slice(0, PAGE_SIZE),
            total: result.length,
            totalPages: Math.max(1, Math.ceil(result.length / PAGE_SIZE)),
          });
          onTotalChange?.(result.length);
        } else {
          setData(result);
          onTotalChange?.(result.total);
        }
      }
    } catch (error) {
      const status = error.response?.status;
      // If the group we're viewing was deleted (404), gracefully bounce back to "All contacts".
      if (status === 404 && viewingGroupId) {
        notify?.('That group no longer exists. Showing all contacts.', 'error');
        onClearGroupView?.();
        return;
      }
      const serverMessage = error.response?.data?.error;
      const fallback = status
        ? `Server returned ${status}.`
        : 'Could not reach the server. Restart it (npm run dev) and try again.';
      setLoadError(serverMessage || fallback);
    } finally {
      setLoading(false);
    }
  }

  // `page` is already inside `params` (rebuilt by the useMemo above) for the
  // all-contacts case, but the group-view branch reads `page` directly. So
  // include it explicitly so changing pages while viewing a group re-slices.
  useEffect(() => { refresh(); }, [params, page, viewingGroupId, groupsRefreshTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    getGroups().then(setGroups).catch(() => {});
  }, [groupsRefreshTick]);

  // Clear the selection whenever the visible set changes. Paging, filtering,
  // or switching the viewed group. Carrying over invisible selections meant
  // "Add 40 to group" could quietly fire against rows the user can no longer
  // see. With this, "selected" always corresponds to rows currently on screen
  // (or what the user explicitly ticked on this page).
  useEffect(() => {
    setSelected(new Set());
  }, [page, filter, viewingGroupId]);

  const viewingGroup = groups.find((group) => group.id === viewingGroupId);

  function toggleSelected(email) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === data.rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.rows.map((row) => row.email)));
    }
  }

  function updateFilter(patch) {
    setFilter((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }

  // Groups are exclusive: an add to group A also removes the email from group B
  // in the DB. The single-row response from patchGroupMembers only carries A,
  // so we always re-fetch the full list afterwards to keep local counts honest.
  async function refreshGroups() {
    try {
      const fresh = await getGroups();
      setGroups(fresh);
    } catch { /* sidebar's onGroupsChange triggers another refresh anyway */ }
  }

  async function addSelectedToGroup(group) {
    const emails = Array.from(selected);
    if (!emails.length) return;
    try {
      await patchGroupMembers(group.id, { add: emails });
      await refreshGroups();
      onGroupsChange?.();
      setSelected(new Set());
      setGroupMenuOpen(false);
      notify(`Added ${emails.length} ${emails.length === 1 ? 'contact' : 'contacts'} to "${group.name}"`);
    } catch (error) {
      notify(error.response?.data?.error || 'Could not add to group', 'error');
    }
  }

  async function addContactToGroup(email, group) {
    try {
      await patchGroupMembers(group.id, { add: [email] });
      await refreshGroups();
      onGroupsChange?.();
      notify(`Added to "${group.name}"`);
    } catch (error) {
      notify(error.response?.data?.error || 'Could not add to group', 'error');
    }
  }

  async function removeContactFromGroup(email) {
    if (!viewingGroupId) return;
    try {
      await patchGroupMembers(viewingGroupId, { remove: [email] });
      await refreshGroups();
      onGroupsChange?.();
      refresh();
      notify('Removed from group');
    } catch (error) {
      notify(error.response?.data?.error || 'Could not remove from group', 'error');
    }
  }

  function confirmRemoveFromGroup(email) {
    setConfirm({
      title: `Remove ${email} from "${viewingGroup?.name}"?`,
      message: 'The contact stays in your audience; they just leave this group.',
      confirmLabel: 'Remove',
      confirmVariant: 'danger',
      onConfirm: () => removeContactFromGroup(email),
    });
  }

  function confirmBulkDelete() {
    if (!selected.size) return;
    setConfirm({
      title: `Delete ${selected.size} contact${selected.size === 1 ? '' : 's'}?`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          const result = await bulkDeleteContacts(Array.from(selected));
          notify(`${result.deleted} deleted`);
          setSelected(new Set());
          refresh();
        } catch (error) {
          notify(error.response?.data?.error || 'Bulk delete failed', 'error');
        }
      },
    });
  }

  function confirmDeleteOne(email) {
    setConfirm({
      title: 'Delete this contact?',
      message: email,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await deleteContact(email);
          notify('Person deleted');
          refresh();
        } catch (error) {
          notify(error.response?.data?.error || 'Could not delete', 'error');
        }
      },
    });
  }

  async function markOptIn(contact) {
    try {
      await updateContact(contact.email, { ...contact, consent: 'yes' });
      notify('Person updated');
      refresh();
    } catch (error) {
      notify(error.response?.data?.error || 'Could not update', 'error');
    }
  }

  async function saveEdit(draft, groupChanges = {}) {
    const { invalid } = validateContacts([draft]);
    if (invalid.length) {
      notify(invalid[0].errors.join(', '), 'error');
      return;
    }
    try {
      await updateContact(editingEmail, draft);
      const adds = groupChanges.groupsToAdd || [];
      const removes = groupChanges.groupsToRemove || [];
      if (adds.length || removes.length) {
        await Promise.all([
          ...adds.map((id) => patchGroupMembers(id, { add: [draft.email] }).catch(() => {})),
          ...removes.map((id) => patchGroupMembers(id, { remove: [draft.email] }).catch(() => {})),
        ]);
        await refreshGroups();
        onGroupsChange?.();
      }
      setEditingEmail('');
      setEditContact(null);
      notify('Contact updated');
      refresh();
    } catch (error) {
      notify(error.response?.data?.error || 'Could not update', 'error');
    }
  }

  async function handleExport() {
    try {
      await downloadContactsCsv({
        search: filter.search || undefined,
        region: filter.region || undefined,
        consent: filter.consent || undefined,
        excludeUnsubscribed: filter.excludeUnsubscribed || undefined,
      });
      notify('Export downloaded');
    } catch (error) {
      notify(error.response?.data?.error || 'Export failed', 'error');
    }
  }

  const allOnPageSelected = data.rows.length > 0 && data.rows.every((row) => selected.has(row.email));

  return (
    <section className="surface contacts-panel">
      <div className="contacts-toolbar">
        <div>
          <h2>Contacts</h2>
          <span className="muted">
            {viewingGroup
              ? `${data.total} in "${viewingGroup.name}"`
              : `${data.total} total`}
            {loading ? ' · loading…' : ''}
          </span>
        </div>
        <div className="table-actions">
          {selected.size > 0 && (
            <>
              <div className="segment-menu" ref={groupMenuRef}>
                <button
                  type="button"
                  onClick={() => setGroupMenuOpen((value) => !value)}
                  aria-expanded={groupMenuOpen}
                  aria-haspopup="menu"
                >
                  <FolderPlus size={14} aria-hidden="true" /> Add {selected.size} to group
                </button>
                {groupMenuOpen && (
                  <div className="segment-menu-panel" role="menu">
                    {groups.length === 0 ? (
                      <p className="muted segment-menu-hint">
                        No groups yet. Create one above to add contacts to it.
                      </p>
                    ) : (
                      <div className="segment-menu-section">
                        <span className="segment-menu-heading">Add to</span>
                        {groups.map((group) => (
                          <button
                            key={group.id}
                            type="button"
                            className="segment-menu-apply"
                            onClick={() => addSelectedToGroup(group)}
                          >
                            {group.name}
                            <span className="muted"> · {(group.contactEmails || []).length}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button type="button" className="danger" onClick={confirmBulkDelete}>
                <Trash2 size={14} aria-hidden="true" /> Delete {selected.size}
              </button>
            </>
          )}
          <button type="button" onClick={handleExport}>
            <Download size={14} aria-hidden="true" /> Export CSV
          </button>
        </div>
      </div>

      {viewingGroup && (
        <div className="group-view-chip">
          <span>
            Viewing group: <strong>{viewingGroup.name}</strong>
          </span>
          <button type="button" className="text-button" onClick={() => onClearGroupView?.()}>
            <X size={12} aria-hidden="true" /> Show all contacts
          </button>
        </div>
      )}

      <div className="contacts-filter-bar">
        <input
          className="list-search"
          placeholder="Search name or email"
          value={filter.search}
          onChange={(event) => updateFilter({ search: event.target.value })}
          disabled={Boolean(viewingGroupId)}
        />
        <input
          placeholder="Region"
          value={filter.region}
          onChange={(event) => updateFilter({ region: event.target.value.toUpperCase() })}
        />
        <select
          value={filter.consent}
          onChange={(event) => updateFilter({ consent: event.target.value })}
        >
          <option value="">Any consent</option>
          <option value="yes">Opted in</option>
          <option value="no">Not opted in</option>
        </select>
        <label className="checkbox-line filter-checkbox">
          <input
            type="checkbox"
            checked={filter.excludeUnsubscribed}
            onChange={(event) => updateFilter({ excludeUnsubscribed: event.target.checked })}
          />
          Hide unsubscribed
        </label>
      </div>

      <div className="contact-list">
        {data.rows.length > 0 && (
          <label className="checkbox-line contact-list-select-all">
            <input
              type="checkbox"
              checked={allOnPageSelected}
              onChange={toggleSelectAll}
              aria-label="Select all visible contacts"
            />
            <span className="muted">
              {selected.size > 0
                ? `${selected.size} selected`
                : `Select all ${data.rows.length}`}
            </span>
          </label>
        )}
        {loadError ? (
          <p className="empty-state error" role="alert">
            {loadError} <button type="button" className="text-button" onClick={refresh}>Retry</button>
          </p>
        ) : loading && data.rows.length === 0 ? (
          <SkeletonList rows={5} />
        ) : (
          <>
            {data.rows.map((contact) => (
              <ContactReadRow
                key={contact.email}
                contact={contact}
                selected={selected.has(contact.email)}
                onToggleSelect={() => toggleSelected(contact.email)}
                onEdit={() => { setEditingEmail(contact.email); setEditContact({ ...contact }); }}
                onOptIn={() => markOptIn(contact)}
                onDelete={() => confirmDeleteOne(contact.email)}
                groups={groups}
                onAddToGroup={(group) => addContactToGroup(contact.email, group)}
                viewingGroupId={viewingGroupId}
                onRemoveFromGroup={() => confirmRemoveFromGroup(contact.email)}
              />
            ))}
            {!data.rows.length && (
              <p className="empty-state">
                {hasActiveFilters(filter)
                  ? 'No people match these filters.'
                  : 'No saved people yet. Upload a CSV or add someone manually above.'}
              </p>
            )}
          </>
        )}
      </div>

      {data.totalPages > 1 && (
        <div className="pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} of {data.totalPages}</span>
          <button type="button" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
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

      {editContact && (
        <ContactEditModal
          contact={editContact}
          groups={groups}
          onSave={saveEdit}
          onCancel={() => { setEditingEmail(''); setEditContact(null); }}
        />
      )}
    </section>
  );
}

function hasActiveFilters(filter) {
  return Boolean(filter.search || filter.region || filter.consent || filter.excludeUnsubscribed);
}

function ContactReadRow({
  contact,
  selected,
  onToggleSelect,
  onEdit,
  onOptIn,
  onDelete,
  groups = [],
  onAddToGroup,
  viewingGroupId,
  onRemoveFromGroup,
}) {
  const issues = complianceIssues(contact, { requireOptIn: true, gdprMode: true });
  const fullName = [contact.firstname, contact.lastname].filter(Boolean).join(' ');
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!groupMenuOpen) return undefined;
    function onOutside(event) {
      if (!menuRef.current?.contains(event.target)) setGroupMenuOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [groupMenuOpen]);

  const availableGroups = groups.filter(
    (group) => !(group.contactEmails || []).includes(contact.email),
  );

  return (
    <div className={`contact-row${selected ? ' selected' : ''}`}>
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={`Select ${contact.email}`}
      />
      <div className="contact-avatar">
        {(contact.firstname || contact.email).slice(0, 1).toUpperCase()}
      </div>
      <div className="contact-main">
        <strong>{fullName || contact.email}</strong>
        <span>{contact.email}</span>
      </div>
      <div className="contact-meta">
        <span>{countryName(contact.region)}</span>
        <span>{contact.consent ? 'Opted in' : 'No opt-in'}</span>
      </div>
      <span className={issues.length ? 'pill amber' : 'pill green'}>
        {issues.length ? 'Hold' : 'Ready'}
      </span>
      <div className="contact-row-actions">
        {issues.length > 0 && (
          <button
            type="button"
            className="row-action"
            onClick={onOptIn}
            title="Mark as opted in"
            aria-label="Mark as opted in"
          >
            <Check size={14} aria-hidden="true" />
          </button>
        )}
        <div className="segment-menu" ref={menuRef}>
          <button
            type="button"
            className="row-action"
            onClick={() => setGroupMenuOpen((value) => !value)}
            title="Add to group"
            aria-label="Add to group"
            aria-expanded={groupMenuOpen}
            aria-haspopup="menu"
          >
            <FolderPlus size={14} aria-hidden="true" />
          </button>
          {groupMenuOpen && (
            <div className="segment-menu-panel" role="menu">
              {availableGroups.length === 0 ? (
                <p className="muted segment-menu-hint">
                  {groups.length === 0
                    ? 'No groups yet. Create one above.'
                    : 'Already in every group.'}
                </p>
              ) : (
                <div className="segment-menu-section">
                  <span className="segment-menu-heading">Add to</span>
                  {availableGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className="segment-menu-apply"
                      onClick={() => {
                        onAddToGroup?.(group);
                        setGroupMenuOpen(false);
                      }}
                    >
                      {group.name}
                      <span className="muted"> · {(group.contactEmails || []).length}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="row-action"
          onClick={onEdit}
          title="Edit"
          aria-label="Edit contact"
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
        {viewingGroupId ? (
          <button
            type="button"
            className="row-action row-action-danger"
            onClick={onRemoveFromGroup}
            title="Remove from group"
            aria-label="Remove from group"
          >
            <FolderMinus size={14} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="row-action row-action-danger"
            onClick={onDelete}
            title="Delete contact"
            aria-label="Delete contact"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
