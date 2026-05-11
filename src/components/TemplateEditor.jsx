import { useId, useMemo, useRef, useState } from 'react';
import { Copy, Image, Link2, MailMinus, MousePointerClick, RefreshCw, Trash2 } from 'lucide-react';
import { EditLinkModal } from './EditLinkModal';
import { InsertButtonModal } from './InsertButtonModal';
import { LogoPicker } from './LogoPicker';
import { getImagesFromHtml, replaceImageSrc } from '../utils/htmlImages';
import { getLinksFromHtml, removeLink, replaceLinkAttrs } from '../utils/htmlLinks';
import { textFromHtml } from '../utils/textFromHtml';

export function TemplateEditor({
  template,
  setTemplate,
  onSave,
  saveStatus,
  notify,
  canDelete,
  onDelete,
  onDuplicate,
}) {
  // picker = null | { mode: 'insert' } | { mode: 'replace', index: number }
  const [picker, setPicker] = useState(null);
  const [buttonModalOpen, setButtonModalOpen] = useState(false);
  const [editingLink, setEditingLink] = useState(null);
  const htmlRef = useRef(null);

  function insertAtCursor(snippet) {
    const textarea = htmlRef.current;
    const current = template.html || '';
    let next;
    if (textarea && document.activeElement === textarea) {
      const start = textarea.selectionStart ?? current.length;
      const end = textarea.selectionEnd ?? current.length;
      next = current.slice(0, start) + snippet + current.slice(end);
      requestAnimationFrame(() => {
        textarea.focus();
        const cursor = start + snippet.length;
        textarea.setSelectionRange(cursor, cursor);
      });
    } else {
      const bodyMatch = current.match(/<body[^>]*>/i);
      if (bodyMatch) {
        const idx = bodyMatch.index + bodyMatch[0].length;
        next = current.slice(0, idx) + '\n' + snippet + current.slice(idx);
      } else {
        next = current ? `${current}\n${snippet}` : snippet;
      }
    }
    setTemplate({ ...template, html: next });
  }
  const nameId = useId();
  const subjectId = useId();
  const htmlId = useId();
  const textId = useId();

  const images = useMemo(() => getImagesFromHtml(template.html), [template.html]);
  const links = useMemo(() => getLinksFromHtml(template.html), [template.html]);

  function openReplace(index) {
    setPicker({ mode: 'replace', index });
  }

  function handlePicked(asset) {
    if (!asset?.url || !picker) {
      setPicker(null);
      return;
    }

    if (picker.mode === 'replace') {
      const next = replaceImageSrc(template.html || '', picker.index, asset.url);
      setTemplate({ ...template, html: next });
      notify?.('Image replaced');
    } else {
      // Two sizing intents from the picker:
      // - 'banner': full-width responsive (max-width:600px;width:100%) —
      //   Canva / Figma marketing banner that fills the email body.
      // - 'logo' (default): centered 140px — header/footer logo.
      // When `linkUrl` is set, wrap the <img> in an <a> so the whole image
      // is clickable (banner anchor uses display:block; logo anchor uses
      // inline-block so it still centers via the parent's text-align).
      const banner = asset.sizeMode === 'banner';
      // Banner mode = full-width, no bottom gap (the banner usually IS the
      // whole email body; spacing should come from whatever sits around it,
      // not baked into the image's margin).
      // Logo mode keeps 24px bottom because logos typically sit above a
      // greeting / paragraph that benefits from breathing room.
      const imgStyle = banner
        ? 'display:block;max-width:600px;width:100%;height:auto;margin:0 auto;border:0;'
        : 'max-width:140px;display:block;margin:0 auto 24px;border:0;';
      const img = `<img src="${asset.url}" alt="${escapeAttr(asset.fileName || 'image')}" style="${imgStyle}">`;
      const linkUrl = asset.linkUrl?.trim();
      let tag;
      if (linkUrl) {
        const anchorStyle = banner
          ? 'display:block;text-decoration:none;'
          : 'display:inline-block;text-decoration:none;';
        tag = `<a href="${escapeAttr(linkUrl)}" rel="noopener noreferrer" target="_blank" style="${anchorStyle}">${img}</a>`;
      } else {
        tag = img;
      }
      insertAtCursor(tag);
      const label = banner ? 'Banner inserted' : 'Image inserted';
      notify?.(linkUrl ? `${label} (clickable)` : label);
    }

    setPicker(null);
  }

  function handleInsertButton(snippet) {
    insertAtCursor(snippet);
    setButtonModalOpen(false);
    notify?.('Button inserted');
  }

  function handleSaveLink(payload) {
    if (!editingLink) return;
    const next = replaceLinkAttrs(template.html || '', editingLink.index, payload);
    setTemplate({ ...template, html: next });
    setEditingLink(null);
    notify?.('Link updated');
  }

  function handleRemoveLink() {
    if (!editingLink) return;
    const next = removeLink(template.html || '', editingLink.index);
    setTemplate({ ...template, html: next });
    setEditingLink(null);
    notify?.('Link removed');
  }

  function handleRegenerateText() {
    const next = textFromHtml(template.html || '');
    setTemplate({ ...template, text: next });
    notify?.('Plain text regenerated from HTML');
  }

  function handleInsertUnsubscribe() {
    // A complete bulletproof footer: bordered top edge, muted text, centered,
    // anchored on the {{unsubscribeUrl}} merge tag so the per-recipient link
    // gets stamped in at send time. Inserts at the cursor (or at the end of
    // <body> if focus isn't in the textarea).
    const snippet = [
      '<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid #e5e7eb;margin-top:32px;padding-top:16px;">',
      '  <tr>',
      '    <td align="center" style="font-family:Arial,sans-serif;font-size:12px;color:#6b7280;line-height:1.5;">',
      '      You\'re receiving this because you signed up.<br>',
      '      <a href="{{unsubscribeUrl}}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>',
      '    </td>',
      '  </tr>',
      '</table>',
    ].join('\n');
    insertAtCursor(snippet);
    notify?.('Unsubscribe footer inserted');
  }

  function removeImage(index) {
    const next = (template.html || '').replace(/<img\b[^>]*?\/?>/gi, (() => {
      let count = 0;
      return (tag) => (count++ === index ? '' : tag);
    })());
    setTemplate({ ...template, html: next });
    notify?.('Image removed');
  }

  return (
    <aside className="surface template-control-panel">
      <div className="template-edit-grid">
        <label htmlFor={nameId}>
          Name
          <input
            id={nameId}
            value={template.name || ''}
            onChange={(event) => setTemplate({ ...template, name: event.target.value })}
            placeholder="e.g. Welcome email"
          />
        </label>
        <label htmlFor={subjectId}>
          Subject
          <input
            id={subjectId}
            value={template.subject || ''}
            onChange={(event) => setTemplate({ ...template, subject: event.target.value })}
            placeholder="e.g. A quick update for {{firstname}}"
          />
        </label>
      </div>

      {(images.length > 0 || links.length > 0) && (
        <div className="template-assets">
          {images.length > 0 && (
            <div className="template-asset-group">
              <div className="template-asset-header">
                <span className="template-asset-title">Images</span>
                <span className="muted">{images.length}</span>
              </div>
              <ul className="template-asset-list">
                {images.map((image) => (
                  <li
                    key={image.index}
                    className="template-asset-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => openReplace(image.index)}
                    onKeyDown={(event) => handleAssetRowKey(event, () => openReplace(image.index))}
                    title="Click to replace image"
                    aria-label={`Replace ${image.alt || `image ${image.index + 1}`}`}
                  >
                    <div className="template-asset-thumb" aria-hidden="true">
                      {image.src
                        ? <img src={image.src} alt="" />
                        : <Image size={14} />}
                    </div>
                    <div className="template-asset-info">
                      <strong>{image.alt || `Image ${image.index + 1}`}</strong>
                      <span className="muted" title={image.src}>
                        {summariseSrc(image.src)}
                      </span>
                    </div>
                    <div className="template-asset-actions">
                      <button
                        type="button"
                        className="row-action row-action-danger"
                        onClick={(event) => { event.stopPropagation(); removeImage(image.index); }}
                        title="Remove image"
                        aria-label="Remove image"
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {links.length > 0 && (
            <div className="template-asset-group">
              <div className="template-asset-header">
                <span className="template-asset-title">Links</span>
                <span className="muted">{links.length}</span>
              </div>
              <ul className="template-asset-list">
                {links.map((link) => {
                  const isPlaceholder = /\[[A-Z_]+\]/.test(link.href);
                  const isMergeTag = /\{\{[^}]+\}\}/.test(link.href);
                  return (
                    <li
                      key={link.index}
                      className="template-asset-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => setEditingLink(link)}
                      onKeyDown={(event) => handleAssetRowKey(event, () => setEditingLink(link))}
                      title="Click to edit link"
                      aria-label={`Edit link: ${link.text}`}
                    >
                      <div className="template-asset-thumb is-link" aria-hidden="true">
                        <Link2 size={14} />
                      </div>
                      <div className="template-asset-info">
                        <strong>{link.text}</strong>
                        <span
                          className={`muted${isPlaceholder ? ' template-link-placeholder' : ''}`}
                          title={link.href}
                        >
                          {summariseHref(link.href) || '(no URL)'}
                          {isPlaceholder && ' · placeholder'}
                          {isMergeTag && ' · merge tag'}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="html-field">
        <div className="html-field-header">
          <label htmlFor={htmlId} className="template-field-label">HTML</label>
          <div className="html-field-tools">
            <button
              type="button"
              className="text-button"
              onClick={() => setPicker({ mode: 'insert' })}
            >
              <Image size={14} aria-hidden="true" /> Insert image
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setButtonModalOpen(true)}
            >
              <MousePointerClick size={14} aria-hidden="true" /> Insert button
            </button>
            <button
              type="button"
              className="text-button"
              onClick={handleInsertUnsubscribe}
              title="Insert a styled unsubscribe footer wired to {{unsubscribeUrl}}"
            >
              <MailMinus size={14} aria-hidden="true" /> Insert unsubscribe
            </button>
          </div>
        </div>
        <textarea
          ref={htmlRef}
          id={htmlId}
          className="code-editor"
          rows="14"
          value={template.html || ''}
          onChange={(event) => setTemplate({ ...template, html: event.target.value })}
          placeholder="<p>Hello {{firstname}},</p>"
        />
        <small className="muted html-field-hint">
          Brevo wraps every <code>&lt;a href&gt;</code> with click tracking — see clicks on the campaign detail page.
        </small>
      </div>

      <details className="plain-text-details">
        <summary>
          Plain text <span className="muted">· optional, auto-generated from HTML</span>
        </summary>
        <div className="plain-text-toolbar">
          <button
            type="button"
            className="text-button"
            onClick={handleRegenerateText}
            disabled={!template.html}
          >
            <RefreshCw size={13} aria-hidden="true" /> Regenerate from HTML
          </button>
        </div>
        <label htmlFor={textId} className="visually-hidden">Plain text</label>
        <textarea
          id={textId}
          rows="5"
          value={template.text || ''}
          onChange={(event) => setTemplate({ ...template, text: event.target.value })}
          placeholder="Leave blank to auto-generate from your HTML"
        />
      </details>

      <div className="template-actions">
        {saveStatus && <span className="muted">{saveStatus}</span>}
        {onDuplicate && (
          <button type="button" onClick={onDuplicate} title="Make a copy of this template">
            <Copy size={14} aria-hidden="true" /> Duplicate
          </button>
        )}
        {canDelete && (
          <button type="button" className="danger" onClick={onDelete}>
            Delete template
          </button>
        )}
        <button type="button" className="primary" onClick={onSave}>Save email</button>
      </div>

      {picker && (
        <LogoPicker
          mode={picker.mode}
          onSelect={handlePicked}
          onClose={() => setPicker(null)}
          notify={notify}
        />
      )}

      {buttonModalOpen && (
        <InsertButtonModal
          onInsert={handleInsertButton}
          onCancel={() => setButtonModalOpen(false)}
        />
      )}

      {editingLink && (
        <EditLinkModal
          link={editingLink}
          onSave={handleSaveLink}
          onCancel={() => setEditingLink(null)}
          onRemove={handleRemoveLink}
        />
      )}
    </aside>
  );
}

function summariseHref(href) {
  if (!href) return '';
  if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return href;
  if (/\{\{[^}]+\}\}/.test(href)) return href;
  if (/^\[[A-Z_]+\]$/.test(href)) return href;
  if (href.length <= 60) return href;
  try {
    const url = new URL(href);
    return `${url.host}${url.pathname.length > 1 ? url.pathname : ''}`;
  } catch {
    return `${href.slice(0, 30)}…${href.slice(-20)}`;
  }
}

function summariseSrc(src) {
  if (!src) return 'no source';
  if (src.length <= 50) return src;
  try {
    const url = new URL(src);
    const file = url.pathname.split('/').pop() || url.hostname;
    return `${url.hostname}/…/${file}`;
  } catch {
    return `${src.slice(0, 24)}…${src.slice(-20)}`;
  }
}

function escapeAttr(value) {
  return String(value).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Activate row-as-button on Enter / Space, ignoring Space when the focus is in
// nested controls (none today, but keeps things robust if we add inputs later).
function handleAssetRowKey(event, action) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
}
