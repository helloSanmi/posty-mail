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

// File extensions we accept for contact uploads. ExcelJS handles the
// modern .xlsx format only (not the pre-2007 binary .xls). We list .xls in
// the accept attribute for friendlier file-picker filtering and reject it
// at parse time with a clear "save as .xlsx" message. ExcelJS is loaded on
// demand via dynamic import so the ~1MB lib stays out of the main bundle.
// CSV continues to use Papa.
const EXCEL_XLSX_EXTENSIONS = ['.xlsx'];
const EXCEL_LEGACY_EXTENSIONS = ['.xls'];
const CSV_EXTENSIONS = ['.csv'];
const ACCEPTED_EXTENSIONS = [...CSV_EXTENSIONS, ...EXCEL_XLSX_EXTENSIONS, ...EXCEL_LEGACY_EXTENSIONS];

// Returns true if any cell in the row has visible content. Used to skip
// blank trailing rows that Excel leaves behind when the user deletes content
// (the row still exists structurally, just every cell is null/empty).
function rowHasContent(row) {
  if (!Array.isArray(row)) return false;
  return row.some((cell) => cell != null && String(cell).trim() !== '');
}

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

  // Common save path used by both CSV and Excel paths once we have an
  // array of plain objects keyed by header. Same group-fallback logic for
  // both file types.
  async function importRows(rows) {
    const parsed = validateContacts(rows);
    if (parsed.invalid.length) {
      notify(`${parsed.invalid.length} row(s) skipped (invalid)`, 'error');
    }
    if (!parsed.valid.length) return;

    // Priority for the group each row lands in:
    //   1. The row's own `group` column from the file (per-row override).
    //   2. The group the admin is currently viewing — if they're staring at
    //      "Newsletter subscribers" and click Upload, every row lands in
    //      that group automatically.
    //   3. No group (the backend leaves them ungrouped).
    const fallbackGroupName = viewingGroupId
      ? (groups.find((g) => g.id === viewingGroupId)?.name || '')
      : '';
    const payload = parsed.valid.map((contact, index) => {
      const original = rows[index] || {};
      const explicitGroup = (original.group || original.Group || '').trim();
      return { ...contact, group: explicitGroup || fallbackGroupName };
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
  }

  function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const lowered = file.name.toLowerCase();
    const isLegacyXls = EXCEL_LEGACY_EXTENSIONS.some((ext) => lowered.endsWith(ext));
    const isXlsx = EXCEL_XLSX_EXTENSIONS.some((ext) => lowered.endsWith(ext));

    if (isLegacyXls) {
      notify('Older .xls files aren\'t supported. Open the file in Excel and "Save As" .xlsx, or export to .csv.', 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (isXlsx) {
      readXlsxAndImport(file);
    } else {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => { importRows(data); },
      });
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // .xlsx parsing via ExcelJS. Actively maintained, zero open vulnerabilities,
  // and handles every XLSX variant we've tested (Microsoft Excel, Google
  // Sheets exports, Apple Numbers exports, LibreOffice). Loaded on demand
  // via dynamic import so the lib (~1MB unpacked) stays out of the main
  // bundle until the first Excel upload.
  async function readXlsxAndImport(file) {
    let ExcelJS;
    try {
      const mod = await import('exceljs');
      ExcelJS = mod.default || mod;
    } catch {
      notify('Could not load Excel parser. Try a CSV instead.', 'error');
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheets = workbook.worksheets || [];

      if (!worksheets.length) {
        notify('Excel file has no sheets.', 'error');
        return;
      }

      // Walk every sheet. Each row's `.values` is sparse (index 0 is unused;
      // cells are 1-based to align with Excel column letters), so we build
      // a clean 0-based array by iterating cellCount + 1. We use cell.text
      // rather than cell.value because text gives the rendered string —
      // handles formulas, hyperlinks, rich-text, dates uniformly.
      let matrix = null;
      let usedSheet = null;
      let diagnosticMatrix = null;
      let diagnosticSheet = null;
      for (const worksheet of worksheets) {
        const rows = [];
        worksheet.eachRow({ includeEmpty: false }, (row) => {
          const cells = [];
          const max = Math.max(row.cellCount || 0, (row.values?.length || 1) - 1);
          for (let i = 1; i <= max; i += 1) {
            const cell = row.getCell(i);
            // cell.text renders formulas / dates / hyperlinks as their
            // visible string. Fall back to cell.value when text is empty
            // (newly-typed values that haven't been rendered yet).
            const text = cell.text != null && cell.text !== ''
              ? cell.text
              : (cell.value == null ? '' : String(cell.value));
            cells.push(text);
          }
          rows.push(cells);
        });

        if (!diagnosticMatrix && rows.length) {
          diagnosticMatrix = rows;
          diagnosticSheet = worksheet.name;
        }
        if (rows.filter(rowHasContent).length >= 2) {
          matrix = rows;
          usedSheet = worksheet.name;
          break;
        }
      }

      const sheetNames = worksheets.map((ws) => ws.name);
      if (!matrix) {
        console.warn('[excel] no sheet passed the header+data check. Parsed:', {
          sheets: sheetNames,
          diagnosticSheet,
          rows: diagnosticMatrix,
        });
        const firstRow = Array.isArray(diagnosticMatrix?.[0])
          ? diagnosticMatrix[0].map((c) => (c == null ? '' : String(c))).filter(Boolean).slice(0, 4).join(' | ')
          : '';
        const nonEmptyRows = diagnosticMatrix ? diagnosticMatrix.filter(rowHasContent).length : 0;
        const sheetLabel = sheetNames.length > 1
          ? `Sheets checked: ${sheetNames.join(', ')}.`
          : 'Only one sheet in the workbook.';
        const detail = diagnosticMatrix
          ? `Parser found ${nonEmptyRows} non-empty row${nonEmptyRows === 1 ? '' : 's'} in "${diagnosticSheet}". First row: ${firstRow || '(all blank)'}.`
          : 'Parser couldn\'t read any rows at all.';
        notify(
          `${detail} Need at least 2 rows (headers + 1+ contacts). ${sheetLabel}`,
          'error',
        );
        return;
      }

      const cleaned = matrix.filter(rowHasContent);
      if (cleaned.length < 2) {
        notify('Excel file has only a header row. Add at least one data row below.', 'error');
        return;
      }
      const headers = cleaned[0].map((h) => String(h ?? '').trim());
      const rows = cleaned.slice(1).map((row) => {
        const obj = {};
        for (let i = 0; i < headers.length; i += 1) {
          if (headers[i]) obj[headers[i]] = String(row[i] ?? '');
        }
        return obj;
      });
      if (usedSheet && sheetNames.length > 1) {
        notify(`Reading sheet "${usedSheet}"…`);
      }
      await importRows(rows);
    } catch (error) {
      notify(error?.message || 'Could not read Excel file', 'error');
    }
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
          title="Upload .csv, .xlsx, or .xls"
          data-tooltip="CSV, XLSX, or XLS"
        >
          <Upload size={14} aria-hidden="true" /> Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          /* Accept CSV plus Excel formats. MIME types are unreliable across
             OSes (some report 'application/octet-stream' for .xlsx) so we
             also list the extensions explicitly. The handler does its own
             extension check to decide which parser to use. */
          accept={`${ACCEPTED_EXTENSIONS.join(',')},text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel`}
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
          /* Pre-fill the group picker with whatever group the admin is
             currently viewing, so "Add contact" while staring at a group
             defaults to adding into THAT group. They can still uncheck it. */
          defaultGroupId={viewingGroupId || undefined}
        />
      )}
    </div>
  );
}
