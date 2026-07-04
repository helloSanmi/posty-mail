import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GripVertical, Trash2 } from 'lucide-react';

// WYSIWYG body editor. Renders the email's real HTML in a contentEditable
// surface so the user edits the actual content in place (click a heading and
// type). ON TOP of that, a gutter of drag handles lets them grab a whole
// content SECTION and drop it above/below another to reorder — the way email
// builders work — plus a delete button per section.
//
// Why an overlay instead of draggable children: the surface is
// contentEditable, and making its children draggable fights the browser's
// text-drag behavior. The handles live in a separate, non-editable overlay
// layer pinned to the left gutter, so dragging and typing never collide.
//
// "Sections" = the email's content rows. Almost every email (and every
// gallery design) is a table whose <tr>s are the logical sections; we detect
// the table body with the most rows and treat those rows as the movable
// units. Falls back to the surface's direct children for non-table HTML.

function findSectionNodes(surface) {
  if (!surface) return [];
  let best = [];
  surface.querySelectorAll('tbody, table').forEach((el) => {
    const rows = Array.from(el.children).filter((c) => c.tagName === 'TR');
    if (rows.length > best.length) best = rows;
  });
  if (best.length >= 2) return best;
  const direct = Array.from(surface.children).filter((c) => c.nodeType === 1);
  return direct.length >= 2 ? direct : [];
}

export function VisualEditor({ html, onChange, ariaLabel = 'Email body' }) {
  const surfaceRef = useRef(null);
  const lastHtml = useRef(null);
  // Section geometry for positioning the handle overlay: [{ top, height }].
  const [sections, setSections] = useState([]);
  // Drag state: which section is being dragged, and where it'd drop.
  const dragIndex = useRef(null);
  const [dropTarget, setDropTarget] = useState(null); // { index, below }

  // Measure each section's position within the scrolled content so the
  // handle overlay can line up with it. Absolute children of the scroll
  // container move with the content, so we store content-space Y
  // (viewport delta + scrollTop) once and don't recompute on scroll.
  function measure() {
    const surface = surfaceRef.current;
    if (!surface) { setSections([]); return; }
    const nodes = findSectionNodes(surface);
    const base = surface.getBoundingClientRect();
    setSections(nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return { top: (r.top - base.top) + surface.scrollTop, height: r.height };
    }));
  }

  // Push external html changes into the DOM (template switch, HTML-tab edit,
  // inserted image) — but never on the user's own keystrokes, which would
  // jump the cursor. Re-measure after any such change.
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (html !== lastHtml.current) {
      surface.innerHTML = html || '';
      lastHtml.current = html || '';
    }
    measure();
  }, [html]);

  // Re-measure when the surface resizes (content grows as the user types,
  // window resizes, fonts load).
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(surface);
    return () => ro.disconnect();
  }, []);

  function emit() {
    const next = surfaceRef.current?.innerHTML || '';
    lastHtml.current = next;
    onChange(next);
  }

  function handleInput() {
    emit();
    measure();
  }

  function handleDragStart(index, event) {
    dragIndex.current = index;
    event.dataTransfer.effectAllowed = 'move';
    // Firefox requires data to be set for a drag to start.
    try { event.dataTransfer.setData('text/plain', String(index)); } catch { /* noop */ }
  }

  function handleDragEnd() {
    dragIndex.current = null;
    setDropTarget(null);
  }

  // While dragging, figure out which section the pointer is over and whether
  // it'd drop above or below that section's midpoint.
  function handleStageDragOver(event) {
    if (dragIndex.current == null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const surface = surfaceRef.current;
    const base = surface.getBoundingClientRect();
    const y = (event.clientY - base.top) + surface.scrollTop;
    let target = { index: sections.length - 1, below: true };
    for (let i = 0; i < sections.length; i += 1) {
      const s = sections[i];
      if (y < s.top + s.height / 2) { target = { index: i, below: false }; break; }
    }
    setDropTarget(target);
  }

  function handleDrop(event) {
    event.preventDefault();
    const from = dragIndex.current;
    dragIndex.current = null;
    const target = dropTarget;
    setDropTarget(null);
    if (from == null || !target) return;

    const surface = surfaceRef.current;
    const nodes = findSectionNodes(surface);
    const dragged = nodes[from];
    let ref = nodes[target.index];
    if (!dragged || !ref || dragged === ref) return;
    const parent = dragged.parentNode;
    if (target.below) ref = ref.nextSibling;
    // If inserting "below" lands right back where it was, bail.
    if (ref === dragged) return;
    parent.insertBefore(dragged, ref);
    emit();
    measure();
  }

  function handleDelete(index) {
    const nodes = findSectionNodes(surfaceRef.current);
    const node = nodes[index];
    if (!node) return;
    node.remove();
    emit();
    measure();
  }

  const indicatorY = dropTarget
    ? (dropTarget.below
      ? sections[dropTarget.index]?.top + sections[dropTarget.index]?.height
      : sections[dropTarget.index]?.top)
    : null;

  return (
    <div className="visual-editor-stage" onDragOver={handleStageDragOver} onDrop={handleDrop}>
      <div
        ref={surfaceRef}
        className="visual-editor-surface"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder="Click here and start writing your email…"
        onInput={handleInput}
      />

      {/* Handle + delete overlay. pointer-events:none except on the controls
          so the email underneath stays clickable/editable. */}
      <div className="visual-editor-overlay" aria-hidden="true">
        {sections.map((s, i) => (
          <div
            key={i}
            className="visual-editor-section-controls"
            style={{ top: `${s.top}px`, height: `${s.height}px` }}
          >
            <span
              className="visual-editor-handle"
              draggable
              title="Drag to move this section"
              onDragStart={(e) => handleDragStart(i, e)}
              onDragEnd={handleDragEnd}
            >
              <GripVertical size={14} aria-hidden="true" />
            </span>
            <button
              type="button"
              className="visual-editor-delete"
              title="Delete this section"
              onClick={() => handleDelete(i)}
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </div>
        ))}
        {indicatorY != null && (
          <div className="visual-editor-drop-line" style={{ top: `${indicatorY}px` }} />
        )}
      </div>
    </div>
  );
}
