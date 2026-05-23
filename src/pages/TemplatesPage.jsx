import { useEffect, useState } from 'react';
import { EmailPreview } from '../components/EmailPreview';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TemplateEditor } from '../components/TemplateEditor';
import { TemplateList } from '../components/TemplateList';
import { defaultTemplates } from '../templates/defaultTemplates';
import { renderTemplate } from '../../shared/campaignUtils.js';
import {
  deleteTemplate,
  getHiddenBuiltinTemplates,
  getSavedTemplates,
  getUnsubscribeCategories,
  saveTemplate,
} from '../services/brevoApi';
import { API_URL } from '../services/apiClient';
import { buildEmailPreviewDocument } from '../utils/emailPreview';
import { textFromHtml } from '../utils/textFromHtml';

// Pointer to the last-viewed template id. Survives page refreshes so the user
// lands back where they were instead of always seeing the first template.
const SELECTED_TEMPLATE_KEY = 'campaign-templates:selectedId';

export function TemplatesPage({ template, setTemplate, contacts, notify }) {
  const [previewDevice, setPreviewDevice] = useState('desktop');
  const [previewClient, setPreviewClient] = useState('gmail');
  const [previewDark, setPreviewDark] = useState(false);
  const [categories, setCategories] = useState([]);
  const [activeTab, setActiveTab] = useState('edit');
  const [savedTemplates, setSavedTemplates] = useState([]);
  const [saveStatus, setSaveStatus] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  // Server-side list of built-in ids the admin has chosen to hide. Empty
  // by default; populated on mount via getHiddenBuiltinTemplates().
  const [hiddenBuiltins, setHiddenBuiltins] = useState(new Set());
  const visibleDefaults = defaultTemplates.filter((t) => !hiddenBuiltins.has(t.id));
  // When the user clicks "+ New", createTemplate() seeds an empty template
  // with a fresh custom-* id that's not yet in savedTemplates. Without
  // adding it to the dropdown options, the <select value> would point at
  // a non-existent option and HTML would silently fall back to showing the
  // first option's label — making the dropdown look like nothing happened
  // even though the editor was cleared. Surfacing it as a "draft" option
  // keeps the picker honest. The draft disappears once the user saves
  // (savedTemplates picks up the same id) or switches away.
  const isUnsavedDraft = Boolean(
    template.id
    && String(template.id).startsWith('custom-')
    && !savedTemplates.some((item) => item.id === template.id)
    && !defaultTemplates.some((item) => item.id === template.id),
  );
  const draftOption = isUnsavedDraft
    ? [{ ...template, name: template.name || 'Untitled template (unsaved)' }]
    : [];
  const templateOptions = [...visibleDefaults, ...draftOption, ...savedTemplates];
  const selectedTemplateId = template.id || templateOptions[0]?.id || '';
  const previewData = buildPreviewData(contacts, template.logoUrl);
  const subject = renderTemplate(template.subject, previewData);
  const html = renderTemplate(template.html, previewData);
  const previewHtml = buildEmailPreviewDocument(html, previewClient, { dark: previewDark });

  useEffect(() => {
    getSavedTemplates().then(setSavedTemplates).catch(() => setSavedTemplates([]));
    getHiddenBuiltinTemplates()
      .then((ids) => setHiddenBuiltins(new Set(Array.isArray(ids) ? ids : [])))
      .catch(() => setHiddenBuiltins(new Set()));
    getUnsubscribeCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  // Restore the previously-selected template once savedTemplates loads, so a
  // refresh doesn't always snap back to the first default template. Persistence
  // happens explicitly inside selectTemplate / createTemplate / handleSaveTemplate
  // NOT in an effect on template.id. Because an effect would fire on mount
  // with the parent's default id and overwrite the persisted value before this
  // restore effect could read it.
  useEffect(() => {
    const persistedId = readSelectedTemplateId();
    if (!persistedId) return;
    const all = [...defaultTemplates, ...savedTemplates];
    const match = all.find((item) => item.id === persistedId);
    if (match && match.id !== template.id) setTemplate(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTemplates]);

  async function handleSaveTemplate() {
    try {
      setSaveStatus('Saving...');
      const fallbackText = textFromHtml(template.html);
      const finalText = (template.text || '').trim() || fallbackText;
      const saved = await saveTemplate({
        ...template,
        name: template.name || 'Untitled template',
        logoUrl: template.logoUrl || '',
        text: finalText,
      });
      // If we generated the text, reflect it back into the editor so the user sees what was saved.
      setTemplate({ ...saved, text: finalText });
      writeSelectedTemplateId(saved.id);
      setSavedTemplates((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      setSaveStatus('Saved');
      notify('Email saved');
    } catch (error) {
      const message = getError(error, 'Save failed');
      setSaveStatus(message);
      notify(message, 'error');
    }
  }

  function selectTemplate(templateId) {
    const selected = templateOptions.find((item) => item.id === templateId);
    if (selected) {
      setTemplate(selected);
      writeSelectedTemplateId(selected.id);
    }
  }

  function createTemplate() {
    const newTemplate = {
      id: `custom-${crypto.randomUUID()}`,
      name: '',
      subject: '',
      html: '',
      text: '',
      logoUrl: '',
    };
    setTemplate(newTemplate);
    writeSelectedTemplateId(newTemplate.id);
    setSaveStatus('');
  }

  async function removeTemplate(templateId) {
    // Backend handles the fork: real DELETE for custom-* rows, write to the
    // hiddenBuiltins Setting for built-ins. Frontend just calls and reflects
    // the result. Hidden-built-ins state is server-truth so other devices
    // see the hide too on their next mount.
    const isBuiltin = !templateId.startsWith('custom-');
    try {
      const result = await deleteTemplate(templateId);
      if (isBuiltin) {
        const next = Array.isArray(result?.hiddenBuiltins)
          ? new Set(result.hiddenBuiltins)
          : new Set([...hiddenBuiltins, templateId]);
        setHiddenBuiltins(next);
      } else {
        setSavedTemplates((items) => items.filter((item) => item.id !== templateId));
      }
      notify('Template deleted');
      if (template.id === templateId) {
        // Pick the first still-visible template as the new selection.
        const stillVisibleBuiltins = defaultTemplates.filter(
          (t) => !(isBuiltin
            ? (Array.isArray(result?.hiddenBuiltins)
              ? new Set(result.hiddenBuiltins)
              : new Set([...hiddenBuiltins, templateId]))
            : hiddenBuiltins
          ).has(t.id),
        );
        const stillVisibleCustom = savedTemplates.filter((t) => t.id !== templateId);
        const fallback = [...stillVisibleBuiltins, ...stillVisibleCustom][0];
        if (fallback) setTemplate(fallback);
        // Clear the pointer so a refresh after delete doesn't try to restore
        // a now-missing template id.
        clearSelectedTemplateId();
      }
    } catch (error) {
      const message = getError(error, 'Delete failed');
      notify(message, 'error');
    }
  }

  function requestDeleteTemplate() {
    const selected = templateOptions.find((item) => item.id === selectedTemplateId);
    if (selected) setDeleteTarget(selected);
  }

  // Make a copy of the current template. The copy gets a new `custom-*` id
  // and a "(copy)" suffix on the name. It's loaded into the editor but NOT
  // saved server-side until the user clicks Save. Gives them a chance to
  // tweak the name first and prevents accidental duplicates on misclicks.
  function duplicateTemplate() {
    const base = templateOptions.find((item) => item.id === selectedTemplateId) || template;
    const copy = {
      ...base,
      id: `custom-${crypto.randomUUID()}`,
      name: `${base.name || 'Untitled template'} (copy)`,
    };
    setTemplate(copy);
    writeSelectedTemplateId(copy.id);
    setSaveStatus('');
    notify('Duplicated. Review and click Save to keep it');
  }

  return (
    <div className="page-stack template-page">
      <section className="template-shell">
        <TemplateList
          templates={templateOptions}
          selectedTemplateId={selectedTemplateId}
          onSelect={selectTemplate}
          onNew={createTemplate}
        />
        <section className="template-main">
          <div className="template-tabs-bar">
            <div className="template-tabs">
              <button
                type="button"
                className={activeTab === 'edit' ? 'active' : ''}
                onClick={() => setActiveTab('edit')}
              >
                Edit
              </button>
              <button
                type="button"
                className={activeTab === 'preview' ? 'active' : ''}
                onClick={() => setActiveTab('preview')}
              >
                Preview
              </button>
            </div>
          </div>
          {activeTab === 'edit' ? (
            <TemplateEditor
              template={template}
              setTemplate={setTemplate}
              onSave={handleSaveTemplate}
              saveStatus={saveStatus}
              notify={notify}
              canDelete={Boolean(selectedTemplateId)}
              onDelete={requestDeleteTemplate}
              onDuplicate={duplicateTemplate}
              categories={categories}
            />
          ) : (
            <EmailPreview
              subject={subject}
              previewClient={previewClient}
              setPreviewClient={setPreviewClient}
              previewDevice={previewDevice}
              setPreviewDevice={setPreviewDevice}
              previewHtml={previewHtml}
              previewDark={previewDark}
              setPreviewDark={setPreviewDark}
            />
          )}
        </section>
      </section>
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete "${deleteTarget.name || 'Untitled template'}"?`}
          message="This removes the template from your list. Campaigns already sent are not changed."
          confirmLabel="Delete"
          confirmVariant="danger"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await removeTemplate(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

function buildPreviewData(contacts, logoUrl) {
  // Build a preview unsubscribe URL pointing at the real /unsubscribe handler.
  // Prefer VITE_PUBLIC_BASE_URL (the tunnel / production URL) so the preview
  // link is reachable from any device. Phones, other networks, etc. Fall
  // back to VITE_API_URL (typically localhost:4010 in dev) which only works
  // when the browser is on the same machine as the backend.
  const publicBase = (import.meta.env.VITE_PUBLIC_BASE_URL || API_URL || '').replace(/\/$/, '');
  const previewEmail = contacts[0]?.email || 'avery@example.com';
  const unsubscribeUrl = publicBase
    ? `${publicBase}/unsubscribe?email=${encodeURIComponent(previewEmail)}&campaign=preview`
    : 'https://example.com/unsubscribe';
  return {
    firstname: 'Avery',
    lastname: 'Stone',
    email: 'avery@example.com',
    unsubscribeUrl,
    ...(contacts[0] || {}),
    logoUrl: logoUrl || fallbackLogo,
  };
}

function getError(error, fallback) {
  return error.response?.data?.error || fallback;
}

function readSelectedTemplateId() {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(SELECTED_TEMPLATE_KEY); } catch { return null; }
}

function writeSelectedTemplateId(id) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(SELECTED_TEMPLATE_KEY, id); } catch { /* ignore */ }
}

function clearSelectedTemplateId() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(SELECTED_TEMPLATE_KEY); } catch { /* ignore */ }
}

const fallbackLogo = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="80">' +
    '<rect width="280" height="80" rx="12" fill="#eef4ff"/>' +
    '<text x="32" y="50" font-family="Arial" font-size="28" ' +
    'font-weight="700" fill="#24599a">Logo</text></svg>',
)}`;
