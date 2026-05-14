import { useEffect } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Heading1,
  Image as ImageIcon,
  Minus,
  MousePointerClick,
  Pilcrow,
  Plus,
  StretchVertical,
  Trash2,
} from 'lucide-react';
import { serializeBlocks } from '../utils/blockSerializer';

// Block-based email editor v1. Stores the structured representation in
// `template.blocks` and keeps `template.html` in sync via the serializer.
// The HTML mode in TemplateEditor remains as an escape hatch; switching from
// HTML back to Visual is a one-way reset (the parsed-from-html-back-to-blocks
// problem is its own rabbit hole and deferred to v2).

const PALETTE = [
  { type: 'heading', label: 'Heading', icon: Heading1, defaults: { level: 2, text: 'Section heading' } },
  { type: 'paragraph', label: 'Text', icon: Pilcrow, defaults: { text: 'Write something nice here.' } },
  { type: 'image', label: 'Image', icon: ImageIcon, defaults: { src: '', alt: '', width: 600, href: '' } },
  { type: 'button', label: 'Button', icon: MousePointerClick, defaults: { label: 'Read more', href: 'https://example.com', bg: '#24599a', color: '#ffffff' } },
  { type: 'divider', label: 'Divider', icon: Minus, defaults: {} },
  { type: 'spacer', label: 'Spacer', icon: StretchVertical, defaults: { height: 24 } },
];

export function BlockEditor({ template, setTemplate }) {
  const blocks = Array.isArray(template?.blocks) ? template.blocks : [];

  // Whenever blocks change, re-serialize into template.html so the rest of
  // the pipeline (preview, send, preflight, sanitize) sees a fresh body.
  // Skipped when blocks is empty so an HTML-only template (no blocks field)
  // doesn't get its body wiped to an empty wrapper on first mount.
  useEffect(() => {
    if (!blocks.length) return;
    const html = serializeBlocks(blocks);
    if (html !== template.html) {
      setTemplate({ ...template, html });
    }
    // We don't want to refire when template.html changes via the textarea;
    // only when the user mutates blocks here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(blocks)]);

  function setBlocks(next) {
    setTemplate({ ...template, blocks: next });
  }

  function updateBlock(index, patchProps) {
    const next = blocks.map((block, i) => (
      i === index ? { ...block, props: { ...(block.props || {}), ...patchProps } } : block
    ));
    setBlocks(next);
  }

  function moveBlock(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    setBlocks(next);
  }

  function removeBlock(index) {
    setBlocks(blocks.filter((_, i) => i !== index));
  }

  function addBlock(type) {
    const recipe = PALETTE.find((p) => p.type === type);
    if (!recipe) return;
    setBlocks([...blocks, { type: recipe.type, props: { ...recipe.defaults } }]);
  }

  return (
    <div className="block-editor">
      <div className="block-palette" role="toolbar" aria-label="Add block">
        <span className="block-palette-label muted">Add</span>
        {PALETTE.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.type}
              type="button"
              onClick={() => addBlock(entry.type)}
              className="block-palette-button"
              title={`Add ${entry.label}`}
            >
              <Icon size={14} aria-hidden="true" /> {entry.label}
            </button>
          );
        })}
      </div>

      {blocks.length === 0 ? (
        <div className="block-empty">
          <Plus size={20} aria-hidden="true" />
          <p>No blocks yet. Pick one above to start.</p>
        </div>
      ) : (
        <ol className="block-list">
          {blocks.map((block, index) => (
            <li key={index} className={`block-row block-row-${block.type}`}>
              <BlockBody block={block} index={index} update={updateBlock} />
              <div className="block-row-controls">
                <button
                  type="button"
                  onClick={() => moveBlock(index, -1)}
                  disabled={index === 0}
                  aria-label="Move up"
                  title="Move up"
                >
                  <ArrowUp size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => moveBlock(index, 1)}
                  disabled={index === blocks.length - 1}
                  aria-label="Move down"
                  title="Move down"
                >
                  <ArrowDown size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => removeBlock(index)}
                  className="block-row-delete"
                  aria-label="Delete block"
                  title="Delete"
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function BlockBody({ block, index, update }) {
  const props = block.props || {};
  switch (block.type) {
    case 'heading':
      return (
        <div className="block-body">
          <label>
            Level
            <select
              value={props.level || 2}
              onChange={(event) => update(index, { level: Number(event.target.value) })}
            >
              <option value={1}>H1 (largest)</option>
              <option value={2}>H2</option>
              <option value={3}>H3</option>
            </select>
          </label>
          <label>
            Text
            <input
              value={props.text || ''}
              onChange={(event) => update(index, { text: event.target.value })}
            />
          </label>
        </div>
      );

    case 'paragraph':
      return (
        <div className="block-body">
          <label>
            Text
            <textarea
              rows={3}
              value={props.text || ''}
              onChange={(event) => update(index, { text: event.target.value })}
              placeholder="Double-newline starts a new paragraph. Single newline becomes <br>."
            />
          </label>
        </div>
      );

    case 'image':
      return (
        <div className="block-body">
          <label>
            Image URL
            <input
              value={props.src || ''}
              onChange={(event) => update(index, { src: event.target.value })}
              placeholder="https://yourdomain.com/banner.png"
            />
          </label>
          <div className="block-body-row">
            <label>
              Alt text
              <input
                value={props.alt || ''}
                onChange={(event) => update(index, { alt: event.target.value })}
                placeholder="Describe the image"
              />
            </label>
            <label>
              Width (px)
              <input
                type="number"
                min="100"
                max="800"
                value={props.width || 600}
                onChange={(event) => update(index, { width: Number(event.target.value) })}
              />
            </label>
          </div>
          <label>
            Click-through URL (optional)
            <input
              value={props.href || ''}
              onChange={(event) => update(index, { href: event.target.value })}
              placeholder="https://yourdomain.com/landing"
            />
          </label>
        </div>
      );

    case 'button':
      return (
        <div className="block-body">
          <div className="block-body-row">
            <label>
              Label
              <input
                value={props.label || ''}
                onChange={(event) => update(index, { label: event.target.value })}
              />
            </label>
            <label>
              URL
              <input
                value={props.href || ''}
                onChange={(event) => update(index, { href: event.target.value })}
                placeholder="https://..."
              />
            </label>
          </div>
          <div className="block-body-row">
            <label>
              Background
              <input
                type="color"
                value={props.bg || '#24599a'}
                onChange={(event) => update(index, { bg: event.target.value })}
              />
            </label>
            <label>
              Text color
              <input
                type="color"
                value={props.color || '#ffffff'}
                onChange={(event) => update(index, { color: event.target.value })}
              />
            </label>
          </div>
        </div>
      );

    case 'divider':
      return <div className="block-body muted">Horizontal rule.</div>;

    case 'spacer':
      return (
        <div className="block-body">
          <label>
            Height (px)
            <input
              type="number"
              min="4"
              max="120"
              value={props.height || 24}
              onChange={(event) => update(index, { height: Number(event.target.value) })}
            />
          </label>
        </div>
      );

    default:
      return <div className="block-body muted">Unknown block type: {block.type}</div>;
  }
}
