import { LayoutTemplate, Plus } from 'lucide-react';

export function TemplateList({
  templates,
  selectedTemplateId,
  onSelect,
  onNew,
  onStartFromGallery,
}) {
  return (
    <aside className="surface template-list-panel">
      <div className="template-list-header">
        <div>
          <strong>Templates</strong>
          <span>{templates.length} saved</span>
        </div>
        <div className="template-list-actions">
          {onStartFromGallery && (
            <button type="button" className="template-gallery-btn" onClick={onStartFromGallery}>
              <LayoutTemplate size={14} aria-hidden="true" /> Start from a design
            </button>
          )}
          <button type="button" className="primary" onClick={onNew}>
            <Plus size={14} aria-hidden="true" /> New
          </button>
        </div>
      </div>

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
        {templates.map((template) => {
          const isSelected = template.id === selectedTemplateId;
          if (!isSelected) return null;
          return <span key={template.id}>{template.subject || 'No subject yet'}</span>;
        })}
      </div>
    </aside>
  );
}
