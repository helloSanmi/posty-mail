import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { TemplateEditor } from './TemplateEditor';

// The composer is the point of the product and it used to be seventh on the
// page, behind name, subject, preheader, reply-to, category and two asset
// inspectors — about 600px down, most of a screen of forms before you could
// type. These pin the order so it cannot drift back.

const TEMPLATE = {
  id: 't1',
  name: 'September newsletter',
  subject: 'A quick update',
  previewText: '',
  html: '<p>Hi</p><img src="https://e.com/a.png" alt="A"><a href="https://e.com/x">X</a>',
  text: '',
};

const mount = (props = {}) => render(
  <TemplateEditor
    template={TEMPLATE}
    setTemplate={() => {}}
    onSave={() => {}}
    saveStatus=""
    notify={() => {}}
    canDelete
    onDelete={() => {}}
    onDuplicate={() => {}}
    categories={[]}
    {...props}
  />,
);

const order = (a, b) => {
  const x = document.querySelector(a);
  const y = document.querySelector(b);
  expect(x).not.toBeNull();
  expect(y).not.toBeNull();
  return Boolean(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
};

describe('TemplateEditor order', () => {
  afterEach(cleanup);

  test('the composer comes before every settings field', () => {
    mount();
    // Two grids now: the subject alone, then everything set once.
    const grids = document.querySelectorAll('.template-edit-grid');
    expect(grids).toHaveLength(2);
    // nth-of-type counts element types, not class matches, so take the
    // second grid off the NodeList rather than from a selector.
    const composer = document.querySelector('.body-editor');
    expect(composer.compareDocumentPosition(grids[1]) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  test('only the subject sits above the composer', () => {
    mount();
    const first = document.querySelector('.template-edit-grid');
    expect(first.querySelectorAll('label')).toHaveLength(1);
    expect(first.textContent).toMatch(/subject/i);
    expect(order('.template-edit-grid', '.body-editor')).toBe(true);
  });

  test('the asset inspectors sit under the thing they inspect', () => {
    // They are derived from template.html; above it they were a readout
    // printed before its source — and they are the reason the composer was
    // pushed furthest down.
    mount();
    expect(order('.body-editor', '.template-assets')).toBe(true);
  });

  test('the name field is below, since the card head already shows it', () => {
    mount();
    expect(order('.body-editor', '.plain-text-details')).toBe(true);
    const second = document.querySelectorAll('.template-edit-grid')[1];
    expect(second.textContent).toMatch(/name/i);
  });

  test('Cmd+S and Ctrl+S save, and stop the browser doing its own thing', () => {
    const onSave = vi.fn();
    mount({ onSave });

    const meta = new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true, bubbles: true });
    window.dispatchEvent(meta);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(meta.defaultPrevented).toBe(true);

    fireEvent.keyDown(window, { key: 'S', ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  test('a bare s does not save', () => {
    const onSave = vi.fn();
    mount({ onSave });
    fireEvent.keyDown(window, { key: 's' });
    expect(onSave).not.toHaveBeenCalled();
  });
});
