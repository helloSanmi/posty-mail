import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { galleryTemplates, galleryCategories } from '../templates/gallery';
import { renderTemplate } from '../../shared/campaignUtils.js';

// "Start from a design" picker. Shows the curated gallery as a grid of live,
// scaled previews grouped by category. Picking one calls onPick(template);
// the parent seeds a fresh editable custom template from it. Read-only —
// choosing never mutates the gallery source.

// Sample values so merge tags render as real text in the thumbnail instead
// of showing {{firstname}} literally.
const SAMPLE = { firstname: 'Alex', lastname: 'Rivera', unsubscribeUrl: '#' };

export function GalleryModal({ onPick, onClose }) {
  const [category, setCategory] = useState('All');

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const visible = useMemo(
    () => (category === 'All'
      ? galleryTemplates
      : galleryTemplates.filter((t) => t.category === category)),
    [category],
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Template gallery">
      <div className="modal-card gallery-modal surface">
        <div className="gallery-modal-header">
          <div>
            <h2>Start from a design</h2>
            <span className="muted">
              Pick a starting point — it opens as a new, fully editable template.
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="gallery-filter" role="tablist" aria-label="Category">
          {['All', ...galleryCategories].map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={category === cat}
              className={`gallery-chip${category === cat ? ' is-active' : ''}`}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="gallery-grid">
          {visible.map((tpl) => (
            <div key={tpl.id} className="gallery-card">
              <div className="gallery-card-preview" aria-hidden="true">
                {/* Scaled, non-interactive live render of the actual HTML. */}
                <iframe
                  title={`${tpl.name} preview`}
                  className="gallery-card-frame"
                  srcDoc={renderTemplate(tpl.html, SAMPLE)}
                  scrolling="no"
                  tabIndex={-1}
                />
              </div>
              <div className="gallery-card-body">
                <div className="gallery-card-meta">
                  <strong>{tpl.name}</strong>
                  <span className="gallery-card-cat">{tpl.category}</span>
                </div>
                <button
                  type="button"
                  className="primary gallery-card-use"
                  onClick={() => onPick(tpl)}
                >
                  Use this design
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
