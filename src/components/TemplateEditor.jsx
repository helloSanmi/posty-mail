import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Copy, Image, Link2, MailMinus, Maximize2, Minimize2, MousePointerClick, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { VisualEditor } from './VisualEditor';
import { CodeArea } from './CodeArea';
import { EditLinkModal } from './EditLinkModal';
import { InsertButtonModal } from './InsertButtonModal';
import { LogoPicker } from './LogoPicker';
import { formatHtml } from '../utils/formatHtml';
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
  // Optional list of preference-center categories. When passed, the editor
  // shows a "Category" picker tied to template.category. Omitted = no picker
  // (legacy installs / pages that don't care about gating).
  categories,
}) {
  // picker = null | { mode: 'insert' } | { mode: 'replace', index: number }
  const [picker, setPicker] = useState(null);
  // More settings is a panel that FLOATS over the canvas rather than pushing
  // it. Opening it used to move the editing surface 330px down the page —
  // fine for a drawer you commit to, wrong for something you flick open to
  // check a link and close again, because the thing you were looking at
  // moves out from under you both times.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const [buttonModalOpen, setButtonModalOpen] = useState(false);
  const [editingLink, setEditingLink] = useState(null);
  // Visual vs HTML editor. One visible at a time; the container has a
  // min-height so switching tabs doesn't shift the page vertically. Both
  // panes stay mounted (display toggled in CSS) so state survives a switch.
  // Default to the Visual (WYSIWYG) editor — you edit the rendered email
  // directly. HTML is the code view for power users.
  const [editorMode, setEditorMode] = useState('visual');
  const htmlRef = useRef(null);

  // Auto-format the HTML so the code view is always pretty-printed — no need
  // to click "Format" by hand. Runs once on mount (when the editor opens in
  // HTML mode with content) and again whenever the user switches TO the HTML
  // tab. We format on tab-switch rather than on every keystroke so it never
  // fights the cursor while typing.
  const didAutoFormat = useRef(false);
  useEffect(() => {
    if (didAutoFormat.current) return;
    didAutoFormat.current = true;
    if (editorMode === 'html' && (template.html || '').trim()) {
      setTemplate((current) => ({ ...current, html: formatHtml(current.html || '') }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showHtmlTab() {
    // Pretty-print on the way in so the HTML always reads cleanly.
    setTemplate((current) => ({ ...current, html: formatHtml(current.html || '') }));
    setEditorMode('html');
  }
  // Expand the body editor (Visual / HTML stage) to fill the viewport. Lets
  // the admin focus on the email body without the page chrome around it.
  const [bodyExpanded, setBodyExpanded] = useState(false);

  // Esc exits fullscreen. Also lock background scroll while expanded.
  useEffect(() => {
    if (!bodyExpanded) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') setBodyExpanded(false);
    }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [bodyExpanded]);

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
  const previewId = useId();
  const replyEmailId = useId();
  const replyNameId = useId();

  // Cmd+S / Ctrl+S saves. The composer is a long document you sit inside
  // for a while, and the habit is universal for that shape of thing — the
  // browser's own "save this page" is never what anyone wants here, so
  // preventDefault is the point rather than a side effect.
  // A floating panel that can only be closed by the control that opened it
  // is a trap, so: outside press and Escape, bound only while it is open.
  useEffect(() => {
    if (!moreOpen) return undefined;
    function onOutside(event) {
      if (!moreRef.current?.contains(event.target)) setMoreOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setMoreOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  useEffect(() => {
    function onKey(event) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      onSave?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave]);
  // htmlId removed: CodeArea owns its own label/id now.
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
      // - 'banner': full-width responsive (max-width:600px;width:100%).
      //   Canva / Figma marketing banner that fills the email body.
      // - 'logo' (default): centered 140px. Header/footer logo.
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
      {/* THE SUBJECT, AND THEN THE CANVAS.
          Everything used to come first — name, subject, preheader, reply-to,
          category, and the image and link inspectors — putting the composer
          about 600px down: most of a screen of forms before you could type
          in the thing the product is for.
          Only the subject stays above it. A subject is part of the MESSAGE —
          the first line a recipient reads, written while you are writing —
          and it is the one field that belongs beside the body. The
          template's NAME is filing, and it is already the card's heading a
          few centimetres up. Everything else follows the composer, in the
          order a person actually reaches for it. */}
      {/* THE HEADER OF THE MESSAGE, in one row, above the canvas.
          These three are what you set while writing — what it is called,
          what it says in the inbox, and what shows under that. They were a
          stacked column of full-width fields that pushed the composer most
          of a screen down; as one compact row they cost about 60px and
          nothing has to be scrolled to.
          Reply-to and Category are set once per template, often never, so
          they sit behind a disclosure rather than taking permanent space. */}
      <div className="template-header-fields">
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
        <label htmlFor={previewId} className="template-field-full">
          Preview text
          <input
            id={previewId}
            value={template.previewText || ''}
            onChange={(event) => setTemplate({ ...template, previewText: event.target.value })}
            placeholder="Shown under the subject line in inbox previews"
            maxLength={200}
          />
        </label>
      </div>

      <div className={`template-more${moreOpen ? ' is-open' : ''}`} ref={moreRef}>
        <button
          type="button"
          className="template-more-toggle"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          More settings
          <span>reply-to, category, images, links</span>
        </button>
        {/* Reply-to, category, and the image and link inspectors: set once
            per template, or consulted rather than written. The inspectors
            come last because they are derived from the body — there is
            nothing to inspect until something has been written. */}
        {moreOpen && (
        <div className="template-more-body">
        <fieldset className="template-replyto-fieldset">
          <legend>Reply-to (optional)</legend>
          <label htmlFor={replyEmailId}>
            Email
            <input
              id={replyEmailId}
              type="email"
              value={template.replyTo?.email || ''}
              onChange={(event) => setTemplate({
                ...template,
                replyTo: { ...(template.replyTo || {}), email: event.target.value },
              })}
              placeholder="replies@yourdomain.com"
              autoComplete="off"
            />
          </label>
          <label htmlFor={replyNameId}>
            Display name
            <input
              id={replyNameId}
              value={template.replyTo?.name || ''}
              onChange={(event) => setTemplate({
                ...template,
                replyTo: { ...(template.replyTo || {}), name: event.target.value },
              })}
              placeholder="e.g. Support team"
              autoComplete="off"
            />
          </label>
        </fieldset>
        {Array.isArray(categories) && categories.length > 0 && (
          <label>
            Category
            <select
              value={template.category || ''}
              onChange={(event) => setTemplate({ ...template, category: event.target.value })}
            >
              <option value="">No category (sends to everyone)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
        )}
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
                        {/* Single line: name only. The full URL still lives in
                            the `title` attribute on the row so a user can hover
                            to see it, but we don't waste vertical space showing
                            a truncated URL nobody reads. */}
                        <strong title={image.src}>{image.alt || `Image ${image.index + 1}`}</strong>
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
                          {/* Single line: link text only. The full href is
                              hover-revealed via title. Inline tags surface
                              "placeholder" / "merge tag" when relevant so the
                              user still knows when an href is unfinished. */}
                          <strong title={link.href || '(no URL)'}>
                            {link.text}
                            {isPlaceholder && <span className="template-asset-tag is-warn"> placeholder</span>}
                            {isMergeTag && <span className="template-asset-tag is-info"> merge</span>}
                          </strong>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
        </div>
        )}
      </div>

      {/* Body editor. Visual / HTML are tabs that share a fixed-height
          container, so switching between them doesn't bump the rest of the
          page up or down. Both panes stay mounted (one is display:none) so
          their internal state survives a tab switch.

          When the user hits the expand button, the wrapper gets the
          `.is-fullscreen` class which lifts it to position:fixed over the
          whole viewport. Esc and the same button collapse it back. */}
      <div className={`body-editor${bodyExpanded ? ' is-fullscreen' : ''}`}>
        <div className="body-editor-tabs" role="tablist" aria-label="Editor mode">
          <button
            type="button"
            role="tab"
            aria-selected={editorMode === 'visual'}
            className={`body-editor-tab${editorMode === 'visual' ? ' is-active' : ''}`}
            onClick={() => setEditorMode('visual')}
          >
            Visual
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={editorMode === 'html'}
            className={`body-editor-tab${editorMode === 'html' ? ' is-active' : ''}`}
            onClick={showHtmlTab}
          >
            HTML
          </button>
          {/* Insert tools work in both modes (they append to the HTML, which
              the Visual surface re-renders). Format is HTML-only — it
              pretty-prints the code view. */}
          <div className="html-field-tools body-editor-tools">
            {editorMode === 'html' && (
              <button
                type="button"
                className="text-button"
                onClick={() => setTemplate({ ...template, html: formatHtml(template.html || '') })}
                title="Pretty-print the HTML: one tag per line, two-space indent"
              >
                <Sparkles size={14} aria-hidden="true" /> Format
              </button>
            )}
            <button
              type="button"
              className="text-button"
              onClick={() => setPicker({ mode: 'insert' })}
            >
              <Image size={14} aria-hidden="true" /> Image
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setButtonModalOpen(true)}
            >
              <MousePointerClick size={14} aria-hidden="true" /> Button
            </button>
            <button
              type="button"
              className="text-button"
              onClick={handleInsertUnsubscribe}
              title="Insert a styled unsubscribe footer wired to {{unsubscribeUrl}}"
            >
              <MailMinus size={14} aria-hidden="true" /> Unsubscribe
            </button>
          </div>
          {/* Expand / collapse. Pinned at the far right of the tab strip so
              it stays in the same screen position whether the editor is
              inline or fullscreen. Visible TEXT label alongside the icon
              so the affordance is obvious — an icon-only button here was
              invisible against the white tab strip. */}
          <button
            type="button"
            className="body-editor-expand"
            onClick={() => setBodyExpanded((value) => !value)}
            title={bodyExpanded ? 'Exit fullscreen (Esc)' : 'Expand editor to fullscreen'}
            aria-label={bodyExpanded ? 'Exit fullscreen' : 'Expand to fullscreen'}
            data-tooltip={bodyExpanded ? 'Exit (Esc)' : 'Fullscreen'}
          >
            {bodyExpanded
              ? <Minimize2 size={14} aria-hidden="true" />
              : <Maximize2 size={14} aria-hidden="true" />}
            <span>{bodyExpanded ? 'Exit' : 'Expand'}</span>
          </button>
        </div>

        <div className="body-editor-stage">
          <div hidden={editorMode !== 'visual'}>
            <VisualEditor
              html={template.html || ''}
              onChange={(next) => setTemplate({ ...template, html: next })}
            />
          </div>
          <div hidden={editorMode !== 'html'}>
            <CodeArea
              value={template.html || ''}
              onChange={(next) => setTemplate({ ...template, html: next })}
              placeholder="<p>Hello {{firstname}},</p>"
              ariaLabel="HTML body"
              textareaRef={htmlRef}
            />
            <small className="muted html-field-hint">
              Tab inserts two spaces. Visual and HTML edit the same content —
              switch freely. Brevo wraps every <code>&lt;a href&gt;</code>{' '}
              with click tracking.
            </small>
          </div>
        </div>
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

      {/* Save is NOT here. It sits in the card head, which is permanently
          on screen — having it in both places meant the same action twice,
          and the copy down here was the one you could not see while
          typing. What is left are the two actions you take deliberately,
          rarely, and after the writing is finished. */}
      <div className="template-actions">
        {saveStatus && <span className="muted">{saveStatus}</span>}
        {onDuplicate && (
          <button
            type="button"
            className="template-action-btn"
            onClick={onDuplicate}
            title="Make a copy of this template"
          >
            <Copy size={14} aria-hidden="true" /> Duplicate
          </button>
        )}
        {canDelete && (
          <button type="button" className="template-action-btn danger" onClick={onDelete}>
            Delete template
          </button>
        )}
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

// summariseHref / summariseSrc were used to truncate noisy URLs for the
// asset inspector rows. The inspector now shows just the alt text / link
// text and stashes the full URL in the row's title attribute, so these
// helpers aren't needed anymore. Removed in the inspector-compact pass.

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

