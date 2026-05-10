import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';

const STYLES = {
  primary: {
    label: 'Primary',
    css: 'background:#24599a;color:#fff;border:0;',
  },
  outline: {
    label: 'Outline',
    css: 'background:#ffffff;color:#24599a;border:1px solid #24599a;',
  },
  dark: {
    label: 'Dark',
    css: 'background:#1f2937;color:#fff;border:0;',
  },
};

export function InsertButtonModal({ onInsert, onCancel }) {
  const [label, setLabel] = useState('Sign up now');
  const [url, setUrl] = useState('https://');
  const [styleKey, setStyleKey] = useState('primary');
  const cancelRef = useRef(null);
  const labelId = useId();
  const urlId = useId();

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(event) { if (event.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const trimmedUrl = url.trim();
  const validUrl = /^https?:\/\/\S+/i.test(trimmedUrl);
  const validLabel = label.trim().length > 0;
  const canInsert = validUrl && validLabel;

  function handleSubmit(event) {
    event.preventDefault();
    if (!canInsert) return;
    const style = `${STYLES[styleKey].css}border-radius:6px;display:inline-block;font-family:Arial,sans-serif;font-size:15px;font-weight:500;padding:12px 24px;text-decoration:none;`;
    const safeUrl = trimmedUrl.replace(/"/g, '&quot;');
    const safeLabel = label
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const snippet = `<a href="${safeUrl}" style="${style}">${safeLabel}</a>`;
    onInsert(snippet);
  }

  const previewStyle = {
    background: STYLES[styleKey].css.match(/background:([^;]+)/)?.[1] || '#24599a',
    color: STYLES[styleKey].css.match(/color:([^;]+)/)?.[1] || '#fff',
    border: STYLES[styleKey].css.match(/border:([^;]+)/)?.[1] || '0',
    borderRadius: '6px',
    display: 'inline-block',
    fontFamily: 'Arial, sans-serif',
    fontSize: '15px',
    fontWeight: 500,
    padding: '12px 24px',
    textDecoration: 'none',
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Insert button">
      <form className="modal-card surface user-modal" onSubmit={handleSubmit}>
        <div className="edit-contact-header">
          <h2>Insert call-to-action button</h2>
          <button type="button" onClick={onCancel} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <label htmlFor={labelId}>
          Button text
          <input
            id={labelId}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Sign up now"
            required
          />
        </label>

        <label htmlFor={urlId}>
          Link URL
          <input
            id={urlId}
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/signup"
            required
          />
          <small className="muted">
            Brevo wraps every link with click tracking automatically.
          </small>
        </label>

        <div className="insert-button-styles">
          <span className="template-field-label">Style</span>
          <div className="insert-button-style-row">
            {Object.entries(STYLES).map(([key, info]) => (
              <button
                key={key}
                type="button"
                className={`insert-button-style${styleKey === key ? ' is-selected' : ''}`}
                onClick={() => setStyleKey(key)}
              >
                {info.label}
              </button>
            ))}
          </div>
        </div>

        <div className="insert-button-preview">
          <span className="template-field-label">Preview</span>
          <div className="insert-button-preview-frame">
            <span style={previewStyle}>{label || 'Button'}</span>
          </div>
        </div>

        <div className="modal-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={!canInsert}>
            Insert button
          </button>
        </div>
      </form>
    </div>
  );
}
