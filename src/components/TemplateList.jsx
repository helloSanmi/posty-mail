import { useState } from 'react';
import { LayoutTemplate, Plus, Search } from 'lucide-react';

// The template picker, as a list rather than a dropdown.
//
// It was a <select>, which is why the panel never scrolled and sat there as
// a short box with a lot of nothing under it. A select also hides the whole
// set behind a click and can only show one line per template, so the
// subject had to be printed separately underneath — meaning you could read
// the subject of the template you had already chosen, and nothing about the
// ones you had not.
//
// The rows carry the template's name and nothing else. A subject line under
// each one doubled the height of the list, which is the thing that has to
// stay scannable — and the subject is on screen anyway the moment a
// template is selected, in the field that owns it. Search earns its place
// once the list is long enough to scroll, which is the same condition that
// made the dropdown bad.

export function TemplateList({
  templates,
  selectedTemplateId,
  onSelect,
  onNew,
  onStartFromGallery,
}) {
  const [query, setQuery] = useState('');
  const hasTemplates = templates.length > 0;

  const term = query.trim().toLowerCase();
  const shown = term
    ? templates.filter((template) => (
      `${template.name || ''} ${template.subject || ''}`.toLowerCase().includes(term)
    ))
    : templates;

  return (
    <aside className="em-card em-list">
      <div className="em-card-head">
        <h2>Templates</h2>
        <div className="em-head-tools">
          <button
            type="button"
            className="em-icon-btn"
            onClick={onNew}
            aria-label="New template"
            title="New template"
          >
            <Plus size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Only once there is enough to sift through. Below that the search
          box is a control that can only ever filter a list you can already
          see in full. */}
      {templates.length > 6 && (
        <span className="em-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search templates"
            aria-label="Search templates"
          />
        </span>
      )}

      {hasTemplates ? (
        <ul className="em-list-items">
          {shown.map((template) => {
            const isActive = template.id === selectedTemplateId;
            return (
              <li key={template.id}>
                <button
                  type="button"
                  className={`em-item${isActive ? ' is-active' : ''}`}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => onSelect(template.id)}
                >
                  <span className="em-item-name">
                    {template.name || 'Untitled template'}
                  </span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && (
            <li className="em-list-none">
              <p className="empty-state">No template matches “{query}”.</p>
            </li>
          )}
        </ul>
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
