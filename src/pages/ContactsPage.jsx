import { useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import { Upload, UserPlus } from 'lucide-react';
import { AddContactModal } from '../components/AddContactModal';
import { ContactsTable } from '../components/ContactsTable';
import { GroupsPanel } from '../components/GroupsPanel';
import { validateContacts } from '../../shared/campaignUtils.js';
import {
  getGroups,
  patchGroupMembers,
  saveContactsLocally,
} from '../services/brevoApi';

export function ContactsPage({ onParsed, refreshContacts, notify }) {
  const [refreshTick, setRefreshTick] = useState(0);
  const [groupsTick, setGroupsTick] = useState(0);
  const [viewingGroupId, setViewingGroupId] = useState(null);
  const [totalContacts, setTotalContacts] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [groups, setGroups] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    getGroups().then(setGroups).catch(() => {});
  }, [groupsTick]);

  function bumpContacts() {
    setRefreshTick((value) => value + 1);
    // Also push the change up to the parent's contact state so the audience
    // count on the dashboard / campaign builder reflects this mutation.
    refreshContacts?.();
  }

  function bumpGroups() {
    setGroupsTick((value) => value + 1);
  }

  function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        const parsed = validateContacts(data);
        if (parsed.invalid.length) {
          notify(`${parsed.invalid.length} row(s) skipped (invalid)`, 'error');
        }
        if (!parsed.valid.length) return;

        // Carry the group column through to the import payload. If the CSV
        // has no group column, we leave it empty. The backend will simply not
        // add the contact to any audience. (We used to auto-tag with
        // "Unspecified", but that created a zombie group that double-counted
        // anyone later added to a real group.)
        const payload = parsed.valid.map((contact, index) => {
          const original = data[index] || {};
          const groupName = (original.group || original.Group || '').trim();
          return { ...contact, group: groupName };
        });

        try {
          const result = await saveContactsLocally(payload);
          const groupCount = Object.keys(result.groups || {}).length;
          const groupNames = Object.entries(result.groups || {})
            .map(([name, info]) => `${name} (${info.added})`)
            .join(', ');
          notify(
            groupCount > 0
              ? `Saved ${result.saved} · ${groupNames}`
              : `Saved ${result.saved} ${result.saved === 1 ? 'contact' : 'contacts'}`,
          );
          onParsed?.({ valid: parsed.valid, invalid: parsed.invalid });
          bumpContacts();
          bumpGroups();
        } catch (error) {
          notify(error.response?.data?.error || 'Save failed', 'error');
        }
      },
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleCreateContact(draft, selectedGroupIds) {
    const { valid, invalid } = validateContacts([draft]);
    if (invalid.length) {
      notify(invalid[0].errors.join(', '), 'error');
      return;
    }
    try {
      await saveContactsLocally(valid);
      if (selectedGroupIds.length > 0) {
        await Promise.all(
          selectedGroupIds.map((id) =>
            patchGroupMembers(id, { add: [valid[0].email] }).catch(() => {}),
          ),
        );
      }
      const groupSuffix = selectedGroupIds.length
        ? ` · added to ${selectedGroupIds.length} group${selectedGroupIds.length === 1 ? '' : 's'}`
        : '';
      notify(`Contact saved${groupSuffix}`);
      setAddOpen(false);
      bumpContacts();
      bumpGroups();
    } catch (error) {
      notify(error.response?.data?.error || 'Save failed', 'error');
    }
  }

  return (
    <div className="page-stack content-page audience-page">
      <div className="audience-actions">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={14} aria-hidden="true" /> Upload CSV
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          className="primary"
          onClick={() => setAddOpen(true)}
        >
          <UserPlus size={14} aria-hidden="true" /> Add contact
        </button>
      </div>

      <div className="audience-split">
        <GroupsPanel
          notify={notify}
          refreshTick={groupsTick}
          viewingGroupId={viewingGroupId}
          onView={setViewingGroupId}
          totalContacts={totalContacts}
          onChange={bumpGroups}
        />
        <ContactsTable
          key={refreshTick}
          notify={notify}
          groupsRefreshTick={groupsTick}
          onGroupsChange={bumpGroups}
          viewingGroupId={viewingGroupId}
          onClearGroupView={() => setViewingGroupId(null)}
          onTotalChange={setTotalContacts}
        />
      </div>

      {addOpen && (
        <AddContactModal
          groups={groups}
          onCreate={handleCreateContact}
          onCancel={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}
