import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';

export function EditLinkModal({ link, onSave, onCancel, onRemove }) {
  const [href, setHref] = useState(link.href || '');
  const [text, setText] = useState(link.text === '(no text)' ? '' : link.text || '');
  const cancelRef = useRef(null);
  const hrefId = useId();
  const textId = useId();
  const isMergeTag = /\{\{[^}]+\}\}/.test(link.href || '');

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(event) { if (event.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const trimmed = href.trim();
  const validHref = trimmed.length > 0 && (
    /^https?:\/\/\S+/i.test(trimmed)
    || /^mailto:\S+/i.test(trimmed)
    || /^tel:\S+/i.test(trimmed)
    || /^#\S*/.test(trimmed)
    || /^\{\{[^}]+\}\}$/.test(trimmed) // permit Brevo merge tags as href
  );
  const hrefChanged = trimmed !== (link.href || '');
  const textChanged = text !== (link.text === '(no text)' ? '' : link.text || '');
  const canSave = (hrefChanged || textChanged) && validHref;

  function handleSubmit(event) {
    event.preventDefault();
    if (!canSave) return;
    const payload = {};
    if (hrefChanged) payload.href = trimmed;
    if (textChanged) payload.text = text;
    onSave(payload);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit link">
      <form className="modal-card surface user-modal" onSubmit={handleSubmit}>
        <div className="edit-contact-header">
          <div>
            <h2>Edit link</h2>
            {isMergeTag && (
              <span className="muted">This URL is a merge tag. Leave as-is unless you know.</span>
            )}
          </div>
          <button type="button" onClick={onCancel} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <label htmlFor={textId}>
          Visible text
          <input
            id={textId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Sign up now"
            disabled={link.text === '(no text)'}
          />
          {link.text === '(no text)' && (
            <small className="muted">
              This link wraps an image or other markup, so the visible text isn&apos;t editable here.
            </small>
          )}
        </label>

        <label htmlFor={hrefId}>
          Link URL
          <input
            id={hrefId}
            type="text"
            value={href}
            onChange={(event) => setHref(event.target.value)}
            placeholder="https://example.com/signup"
            required
          />
          <div className="edit-link-presets">
            <button
              type="button"
              className="text-button"
              onClick={() => setHref('{{unsubscribeUrl}}')}
              title="Per-recipient unsubscribe link, replaced at send time"
            >
              Use unsubscribe link
            </button>
          </div>
          <small className="muted">
            Brevo wraps every link with click tracking. Supports <code>http(s)://</code>,{' '}
            <code>mailto:</code>, <code>tel:</code>, anchors, and merge tags.
          </small>
        </label>

        <div className="modal-actions edit-link-actions">
          {onRemove && (
            <button
              type="button"
              className="text-button danger"
              onClick={onRemove}
            >
              Remove link
            </button>
          )}
          <div className="edit-link-actions-right">
            <button ref={cancelRef} type="button" onClick={onCancel}>Cancel</button>
            <button type="submit" className="primary" disabled={!canSave}>
              Save link
            </button>
          </div>
        </div>

        {validHref && /^https?:\/\//i.test(trimmed) && (
          <a
            href={trimmed}
            target="_blank"
            rel="noopener noreferrer"
            className="edit-link-test"
          >
            <ExternalLink size={12} aria-hidden="true" /> Open in new tab
          </a>
        )}
      </form>
    </div>
  );
}
