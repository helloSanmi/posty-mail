import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check, Download, FolderMinus, FolderPlus, Globe2, Pencil, Trash2, X,
} from 'lucide-react';
import { countryName, otherCountryOptions, priorityCountryOptions } from '../data/countries';
import { complianceIssues, validateContacts } from '../../shared/campaignUtils.js';
import {
  bulkDeleteContacts,
  bulkUpdateContacts,
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

// Client-side mirror of the backend's filter rules (backend/lib/segmentFilter.js
// filterToWhere — search across email/firstname/lastname case-insensitive,
// region exact, consent exact). Used only on the group-view branch because
// the /api/groups/:id/contacts endpoint returns the full member list without
// applying query filters. excludeUnsubscribed isn't honored here — that would
// require fetching the unsubscribe set; the toolbar checkbox is hidden when
// viewing a group anyway.
function applyClientFilter(rows, filter) {
  const search = (filter.search || '').trim().toLowerCase();
  const region = (filter.region || '').trim().toLowerCase();
  const consent = (filter.consent || '').trim().toLowerCase();
  if (!search && !region && !consent) return rows;
  return rows.filter((row) => {
    if (search) {
      const haystack = [row.email, row.firstname, row.lastname]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (region && String(row.region || '').toLowerCase() !== region) return false;
    if (consent && String(row.consent || '').toLowerCase() !== consent) return false;
    return true;
  });
}

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
  // Same dropdown pattern as the "Move N to group" menu — open state + a
  // click-outside listener — but for the bulk "Set region for N selected"
  // action.
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);
  const regionMenuRef = useRef(null);

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

  useEffect(() => {
    if (!regionMenuOpen) return undefined;
    function handleOutside(event) {
      if (!regionMenuRef.current?.contains(event.target)) {
        setRegionMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [regionMenuOpen]);

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
        // The group endpoint returns the full member list. Slice client-side
        // for the same 40-per-page UX, AND apply the search/region/consent
        // filters here too — the group endpoint doesn't support them
        // server-side, so without this the filter bar would silently no-op
        // while viewing a group.
        const allRows = await getGroupContacts(viewingGroupId);
        const rows = applyClientFilter(allRows, filter);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [params, page, viewingGroupId, groupsRefreshTick]);
  useEffect(() => {
    getGroups().then(setGroups).catch(() => {});
  }, [groupsRefreshTick]);

  // Clear the selection whenever the visible set changes. Paging, filtering,
  // or switching the viewed group. Carrying over invisible selections meant
  // "Move 40 to group" could quietly fire against rows the user can no longer
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

  // Groups are exclusive: moving a contact into group A also removes them from
  // group B in the DB. The single-row response from patchGroupMembers only
  // carries A, so we always re-fetch the full list afterwards to keep local
  // counts honest. (The UI calls this "Move" everywhere; the underlying API
  // method name is still patchGroupMembers with an `add` list because that's
  // what the backend route expects — exclusivity is enforced server-side.)
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
      notify(`Moved ${emails.length} ${emails.length === 1 ? 'contact' : 'contacts'} to "${group.name}"`);
    } catch (error) {
      notify(error.response?.data?.error || 'Could not move to group', 'error');
    }
  }

  // Bulk set region across selected contacts. The user's most common
  // workflow is "select a whole group → set region to UK" so this lives
  // alongside the Move-to-group bulk action. Backend uses Prisma
  // updateMany so even thousands of rows are one SQL statement.
  async function setRegionForSelected(regionCode, regionLabel) {
    const emails = Array.from(selected);
    if (!emails.length) return;
    try {
      const result = await bulkUpdateContacts(emails, { region: regionCode });
      setRegionMenuOpen(false);
      refresh();
      notify(`Set region to ${regionLabel} for ${result.updated} ${result.updated === 1 ? 'contact' : 'contacts'}`);
    } catch (error) {
      notify(error.response?.data?.error || 'Could not set region', 'error');
    }
  }

  async function addContactToGroup(email, group) {
    try {
      await patchGroupMembers(group.id, { add: [email] });
      await refreshGroups();
      onGroupsChange?.();
      notify(`Moved to "${group.name}"`);
    } catch (error) {
      notify(error.response?.data?.error || 'Could not move to group', 'error');
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
          // Refresh both the contact list AND the groups sidebar — deleted
          // contacts cascade out of their group memberships server-side, so
          // the per-group counts need to re-fetch or they'd look stale.
          refresh();
          await refreshGroups();
          onGroupsChange?.();
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
          // Same as bulk-delete: refresh groups so the sidebar counts are
          // honest about the new membership.
          refresh();
          await refreshGroups();
          onGroupsChange?.();
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
                  <FolderPlus size={14} aria-hidden="true" /> Move {selected.size} to group
                </button>
                {groupMenuOpen && (
                  <div className="segment-menu-panel" role="menu">
                    {groups.length === 0 ? (
                      <p className="muted segment-menu-hint">
                        No groups yet. Create one above to move contacts into it.
                      </p>
                    ) : (
                      <div className="segment-menu-section">
                        <span className="segment-menu-heading">Move to</span>
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
              <div className="segment-menu" ref={regionMenuRef}>
                <button
                  type="button"
                  onClick={() => setRegionMenuOpen((value) => !value)}
                  aria-expanded={regionMenuOpen}
                  aria-haspopup="menu"
                >
                  <Globe2 size={14} aria-hidden="true" /> Set region for {selected.size}
                </button>
                {regionMenuOpen && (
                  <div className="segment-menu-panel" role="menu">
                    <div className="segment-menu-section">
                      <span className="segment-menu-heading">Set region to</span>
                      {priorityCountryOptions.map(([code, label]) => (
                        <button
                          key={code}
                          type="button"
                          className="segment-menu-apply"
                          onClick={() => setRegionForSelected(code, label)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="segment-menu-section">
                      <span className="segment-menu-heading">Other regions</span>
                      {otherCountryOptions.map(([code, label]) => (
                        <button
                          key={code}
                          type="button"
                          className="segment-menu-apply"
                          onClick={() => setRegionForSelected(code, label)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
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
  // anchorRef points at the trigger button; popupRef at the popup element
  // (rendered in a portal). Outside-click closes when both are missed.
  const anchorRef = useRef(null);
  const popupRef = useRef(null);
  // Popup coordinates — viewport-relative because we render via portal into
  // document.body, escaping the contact-list's overflow:auto clip. Without
  // this the popup was getting sliced off at the bottom of the scroll port
  // whenever the trigger row sat near the bottom of the visible list.
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!groupMenuOpen) return undefined;
    function onOutside(event) {
      const inAnchor = anchorRef.current?.contains(event.target);
      const inPopup = popupRef.current?.contains(event.target);
      if (!inAnchor && !inPopup) setGroupMenuOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [groupMenuOpen]);

  // Re-measure the trigger and place the popup on open + on scroll/resize.
  // useLayoutEffect runs synchronously after DOM mutation, before paint, so
  // the user sees the popup at the correct position in the same frame.
  //
  // Placement strategy: try below the trigger. If the popup's height won't
  // fit between the trigger and the viewport bottom, flip and place it
  // ABOVE the trigger instead. Prevents the last group rows from sitting
  // off-screen when the trigger row is near the bottom of the viewport.
  // The popup is positioned by its right edge (CSS `translateX(-100%)`)
  // so it visually matches the old absolute layout.
  useLayoutEffect(() => {
    if (!groupMenuOpen) return undefined;
    function place() {
      const triggerRect = anchorRef.current?.getBoundingClientRect();
      if (!triggerRect) return;
      // Height is determined by content, so we can read it regardless of
      // where the popup is currently positioned (the previous setPopupPos
      // may have stuck it temporarily at 0,0).
      const popupHeight = popupRef.current?.offsetHeight || 0;
      const margin = 8;
      const spaceBelow = window.innerHeight - triggerRect.bottom - margin;
      const fitsBelow = popupHeight === 0 || popupHeight <= spaceBelow;
      const top = fitsBelow
        ? triggerRect.bottom + 6
        : Math.max(margin, triggerRect.top - popupHeight - 6);
      setPopupPos({ top, left: triggerRect.right });
    }
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [groupMenuOpen]);

  // Render every group in the popup so the user always sees their full
  // inventory, but mark the one the contact is already in as the current
  // home (disabled + "current" tag). Showing only "available" groups was
  // confusing when a user has just two groups — the popup would render a
  // single row and look truncated.
  const groupContainsContact = (group) =>
    (group.contactEmails || []).includes(contact.email);
  const hasAnyOtherGroup = groups.some((group) => !groupContainsContact(group));

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
            data-tooltip="Mark as opted in"
          >
            <Check size={14} aria-hidden="true" />
          </button>
        )}
        <button
          ref={anchorRef}
          type="button"
          className="row-action"
          onClick={() => setGroupMenuOpen((value) => !value)}
          title="Move to group"
          aria-label="Move to group"
          aria-expanded={groupMenuOpen}
          aria-haspopup="menu"
          data-tooltip="Move to group"
        >
          <FolderPlus size={14} aria-hidden="true" />
        </button>
        {groupMenuOpen && createPortal(
          <div
            ref={popupRef}
            className="segment-menu-panel segment-menu-panel--floating"
            role="menu"
            style={{ top: popupPos.top, left: popupPos.left }}
          >
            {groups.length === 0 ? (
              <p className="muted segment-menu-hint">
                No groups yet. Create one above.
              </p>
            ) : (
              <div className="segment-menu-section">
                <span className="segment-menu-heading">Move to</span>
                {groups.map((group) => {
                  const isCurrent = groupContainsContact(group);
                  return (
                    <button
                      key={group.id}
                      type="button"
                      className={`segment-menu-apply${isCurrent ? ' is-current' : ''}`}
                      disabled={isCurrent}
                      aria-label={
                        isCurrent
                          ? `${group.name} — current group`
                          : `Move to ${group.name}`
                      }
                      onClick={() => {
                        if (isCurrent) return;
                        onAddToGroup?.(group);
                        setGroupMenuOpen(false);
                      }}
                    >
                      <span className="segment-menu-apply-name">{group.name}</span>
                      <span className="muted">
                        {' · '}
                        {(group.contactEmails || []).length}
                        {isCurrent ? ' · current' : ''}
                      </span>
                    </button>
                  );
                })}
                {!hasAnyOtherGroup && (
                  <p className="muted segment-menu-hint">
                    Create another group to move this contact.
                  </p>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
        <button
          type="button"
          className="row-action"
          onClick={onEdit}
          title="Edit contact"
          aria-label="Edit contact"
          data-tooltip="Edit contact"
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
        {/* When viewing a specific group, surface BOTH actions: remove from
            this group (contact stays in audience) and delete the contact
            entirely. The two are easy to confuse if only one is shown, so
            we keep them adjacent and rely on the tooltips + the
            visually-distinct icons (FolderMinus vs. Trash2) to disambiguate. */}
        {viewingGroupId && (
          <button
            type="button"
            className="row-action row-action-danger"
            onClick={onRemoveFromGroup}
            title="Remove from this group"
            aria-label="Remove from group"
            data-tooltip="Remove from group"
          >
            <FolderMinus size={14} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="row-action row-action-danger"
          onClick={onDelete}
          title="Delete contact from audience"
          aria-label="Delete contact"
          data-tooltip="Delete contact"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
