import { useEffect, useState } from 'react';
import { EmailPreview } from '../components/EmailPreview';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TemplateEditor } from '../components/TemplateEditor';
import { TemplateList } from '../components/TemplateList';
import { GalleryModal } from '../components/GalleryModal';
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
  // Which pane of the editor column is showing. Both stay mounted and are
  // toggled with `hidden`, so switching does not remount the editor or
  // reload the preview iframe.
  const [activeTab, setActiveTab] = useState('edit');
  const [previewDevice, setPreviewDevice] = useState('desktop');
  const [previewClient, setPreviewClient] = useState('gmail');
  const [previewDark, setPreviewDark] = useState(false);
  const [categories, setCategories] = useState([]);
  const [savedTemplates, setSavedTemplates] = useState([]);
  const [saveStatus, setSaveStatus] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
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

  // Seed a fresh, unsaved custom template from a gallery design. Same shape
  // as createTemplate() but pre-filled with the picked design's subject /
  // preview / HTML. It shows as an unsaved draft until the user hits Save.
  function startFromGallery(galleryTemplate) {
    const newTemplate = {
      id: `custom-${crypto.randomUUID()}`,
      name: galleryTemplate.name,
      subject: galleryTemplate.subject || '',
      previewText: galleryTemplate.previewText || '',
      html: galleryTemplate.html || '',
      text: '',
      logoUrl: '',
    };
    setTemplate(newTemplate);
    writeSelectedTemplateId(newTemplate.id);
    setSaveStatus('');
    setGalleryOpen(false);
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
      {/* Two columns: the templates you have, and the one you are working
          on. Edit and Preview are tabs of that second column rather than a
          third column beside it — a preview squeezed into 360px is not
          what the email looks like, so it was costing real editing width to
          show something that still had to be checked properly elsewhere.
          Both panels stay mounted and are toggled with `hidden`, so
          switching to Preview and back does not remount the editor or
          reload the preview iframe. */}
      <div className="em-grid">
        <TemplateList
          templates={templateOptions}
          selectedTemplateId={selectedTemplateId}
          onSelect={selectTemplate}
          onNew={createTemplate}
          onStartFromGallery={() => setGalleryOpen(true)}
        />

        {/* em-card as well as em-editor: the list beside it is a padded
            card, and without the same box the editor's title sat a
            padding's height above the list's, so the two columns started
            at different heights. */}
        <section className="em-card em-editor">
          {/* The editor column names what you are editing, so the answer
              doesn't depend on reading the Name field or re-opening the
              picker. The draft pill is the only status the list can't
              show, and saveStatus is repeated here because the editor's
              own action row sits far below the fold on a long template. */}
          <div className="em-card-head">
            <h2>{template.name || 'Untitled template'}</h2>
            <div className="em-head-right">
              {isUnsavedDraft && <span className="pill amber">Unsaved draft</span>}
              {saveStatus && (
                <span className="status-line" role="status">{saveStatus}</span>
              )}
              <div className="em-tabs" role="tablist" aria-label="Template view">
                <button
                  type="button"
                  role="tab"
                  id="em-tab-edit"
                  aria-selected={activeTab === 'edit'}
                  aria-controls="em-panel-edit"
                  className={`em-tab${activeTab === 'edit' ? ' is-active' : ''}`}
                  onClick={() => setActiveTab('edit')}
                >
                  Edit
                </button>
                <button
                  type="button"
                  role="tab"
                  id="em-tab-preview"
                  aria-selected={activeTab === 'preview'}
                  aria-controls="em-panel-preview"
                  className={`em-tab${activeTab === 'preview' ? ' is-active' : ''}`}
                  onClick={() => setActiveTab('preview')}
                >
                  Preview
                </button>
              </div>
              {/* Save lives in the head, not only at the foot of the panel.
                  With the composer first, the caret sits ~390px above the
                  editor's own action row — so the button you reach for most
                  was the one furthest from where you were typing. Here it is
                  a fixed distance away, always on screen, and it is the same
                  handler the foot of the panel calls. */}
              {activeTab === 'edit' && (
                <button
                  type="button"
                  className="em-btn em-btn-primary em-btn-tabsize"
                  onClick={handleSaveTemplate}
                >
                  Save
                </button>
              )}
            </div>
          </div>
          <div
            role="tabpanel"
            id="em-panel-edit"
            aria-labelledby="em-tab-edit"
            hidden={activeTab !== 'edit'}
          >
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
          </div>
          <div
            role="tabpanel"
            id="em-panel-preview"
            aria-labelledby="em-tab-preview"
            hidden={activeTab !== 'preview'}
          >
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
          </div>
        </section>

      </div>
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

      {galleryOpen && (
        <GalleryModal
          onPick={startFromGallery}
          onClose={() => setGalleryOpen(false)}
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
