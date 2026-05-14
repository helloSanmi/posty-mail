import { useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';

const MAX_VISIBLE = 200;

export function GroupSelector({
  groups,
  selectedIds,
  onChange,
  emptyMessage,
  compact = false,
  showAllContactsOption = false,
}) {
  const [query, setQuery] = useState('');

  const selectedSet = useMemo(() => new Set(selectedIds || []), [selectedIds]);
  const selectedGroups = useMemo(
    () => (groups || []).filter((group) => selectedSet.has(group.id)),
    [groups, selectedSet],
  );

  // Search bar only earns its keep when there are enough groups to scroll past.
  // In compact mode (used inside small popovers) we also skip the chip area
  // because the trigger button already shows the selection summary.
  const showSearch = !compact || (groups || []).length > 10;
  const showChips = !compact && selectedGroups.length > 0;
  // "All contacts" is rendered as a sticky top row when the parent asks for it.
  // Hidden while the search box is active so the user can find groups by name.
  const showAllContacts = showAllContactsOption && !query.trim();
  const allSelected = (selectedIds || []).length === 0;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return groups || [];
    return (groups || []).filter((group) => group.name.toLowerCase().includes(term));
  }, [groups, query]);

  const visible = filtered.slice(0, MAX_VISIBLE);
  const truncated = filtered.length > MAX_VISIBLE;

  function toggle(id) {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  }

  if (!groups?.length) {
    // No groups exist yet, but the parent still wants to let the admin pick
    // "All contacts" explicitly so the recipients field can move out of its
    // placeholder state.
    if (showAllContactsOption) {
      return (
        <div className={`group-selector-v2${compact ? ' is-compact' : ''}`}>
          <ul className="group-selector-list" role="listbox" aria-label="Recipients">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={allSelected}
                className={`group-selector-row${allSelected ? ' is-checked' : ''}`}
                onClick={() => onChange([])}
              >
                <span className="group-selector-check" aria-hidden="true">
                  {allSelected && <Check size={12} />}
                </span>
                <span className="group-selector-name">All contacts</span>
              </button>
            </li>
          </ul>
          <p className="muted group-selector-empty">
            {emptyMessage || 'No groups yet. Create one from the Audience page.'}
          </p>
        </div>
      );
    }
    return (
      <p className="muted group-selector-empty">
        {emptyMessage || 'No groups yet. Create one from the Audience page.'}
      </p>
    );
  }

  return (
    <div className={`group-selector-v2${compact ? ' is-compact' : ''}`}>
      {showChips && (
        <div className="group-selector-selected" role="list" aria-label="Selected groups">
          {selectedGroups.map((group) => (
            <span key={group.id} role="listitem" className="group-selector-tag">
              {group.name}
              <button
                type="button"
                onClick={() => toggle(group.id)}
                aria-label={`Remove ${group.name}`}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {showSearch && (
        <div className="group-selector-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${groups.length} group${groups.length === 1 ? '' : 's'}…`}
            aria-label="Search groups"
          />
          <span className="muted group-selector-count">
            {selectedGroups.length} selected
          </span>
        </div>
      )}

      <ul className="group-selector-list" role="listbox" aria-label="Groups">
        {showAllContacts && (
          <li>
            <button
              type="button"
              role="option"
              aria-selected={allSelected}
              className={`group-selector-row group-selector-row-all${allSelected ? ' is-checked' : ''}`}
              onClick={() => onChange([])}
            >
              <span className="group-selector-check" aria-hidden="true">
                {allSelected && <Check size={12} />}
              </span>
              <span className="group-selector-name">All contacts</span>
              <span className="muted group-selector-meta">Everyone</span>
            </button>
          </li>
        )}
        {visible.length === 0 ? (
          <li className="muted group-selector-no-match">No groups match &quot;{query}&quot;.</li>
        ) : (
          visible.map((group) => {
            const checked = selectedSet.has(group.id);
            return (
              <li key={group.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className={`group-selector-row${checked ? ' is-checked' : ''}`}
                  onClick={() => toggle(group.id)}
                >
                  <span className="group-selector-check" aria-hidden="true">
                    {checked && <Check size={12} />}
                  </span>
                  <span className="group-selector-name">{group.name}</span>
                  <span className="muted group-selector-meta">
                    {(group.contactEmails || []).length}
                  </span>
                </button>
              </li>
            );
          })
        )}
        {truncated && (
          <li className="muted group-selector-more">
            …{filtered.length - MAX_VISIBLE} more. Refine your search to see them.
          </li>
        )}
      </ul>
    </div>
  );
}
