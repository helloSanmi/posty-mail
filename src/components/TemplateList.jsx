import { LayoutTemplate, Plus } from 'lucide-react';

export function TemplateList({
  templates,
  selectedTemplateId,
  onSelect,
  onNew,
  onStartFromGallery,
}) {
  const hasTemplates = templates.length > 0;
  const selected = templates.find((template) => template.id === selectedTemplateId);

  return (
    <aside className="surface template-list-panel">
      <div className="template-list-header">
        <div>
          <strong>Templates</strong>
          <span>{templates.length} available</span>
        </div>
        <button type="button" className="primary" onClick={onNew}>
          <Plus size={14} aria-hidden="true" /> New
        </button>
      </div>

      {hasTemplates ? (
        <>
          <label className="template-select-label" htmlFor="template-select">
            Choose template
            <select
              id="template-select"
              value={selectedTemplateId}
              onChange={(event) => onSelect(event.target.value)}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name || 'Untitled template'}
                </option>
              ))}
            </select>
          </label>

          <div className="template-select-summary">
            {selected?.subject || 'No subject yet'}
          </div>
        </>
      ) : (
        <div className="template-empty">
          <LayoutTemplate size={22} aria-hidden="true" />
          <strong>No templates</strong>
          <p>Nothing to choose from yet. Start a new one, or pick a ready-made design.</p>
        </div>
      )}

      {onStartFromGallery && (
        <button type="button" className="template-gallery-btn" onClick={onStartFromGallery}>
          <LayoutTemplate size={15} aria-hidden="true" /> Start from a design
        </button>
      )}
    </aside>
  );
}
