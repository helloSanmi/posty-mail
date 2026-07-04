import { useEffect, useRef } from 'react';

// WYSIWYG body editor. Renders the email's actual HTML in a contentEditable
// surface so the user edits the real content in place — click into a heading
// or paragraph and type. Edits flow straight back to template.html, so this
// works for ANY template (a gallery design, pasted HTML, anything) rather
// than only block-built ones.
//
// The React + contentEditable dance: we set the DOM innerHTML only when the
// incoming `html` differs from what we last wrote (an EXTERNAL change — a
// template switch, an HTML-tab edit, an inserted image). We never reset it
// on the user's own keystrokes, which would yank the cursor to the top.
// `lastHtml` starts null so the very first render populates the surface.
export function VisualEditor({ html, onChange, ariaLabel = 'Email body' }) {
  const ref = useRef(null);
  const lastHtml = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (html !== lastHtml.current) {
      el.innerHTML = html || '';
      lastHtml.current = html || '';
    }
  }, [html]);

  function handleInput() {
    const next = ref.current?.innerHTML || '';
    // Record what we're about to emit so the effect above treats the
    // resulting prop change as "already in the DOM" and leaves the cursor be.
    lastHtml.current = next;
    onChange(next);
  }

  return (
    <div className="visual-editor-stage">
      <div
        ref={ref}
        className="visual-editor-surface"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder="Click here and start writing your email…"
        onInput={handleInput}
      />
    </div>
  );
}
