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

  test('the message header is one compact row above the composer', () => {
    // Name, subject and preview text are what you set WHILE writing, so
    // they stay in reach — but as a stacked column they cost ~190px and
    // pushed the canvas most of a screen down. One row costs ~60px.
    mount();
    const header = document.querySelector('.template-header-fields');
    expect(header).not.toBeNull();
    expect(header.querySelectorAll('label')).toHaveLength(3);
    expect(order('.template-header-fields', '.body-editor')).toBe(true);
  });

  test('everything consulted rather than written is one click away', () => {
    mount();
    const more = document.querySelector('.template-more');
    expect(more).not.toBeNull();
    expect(more.open).toBe(false);
    // Still rendered — a disclosure hides, it does not remove.
    expect(more.querySelector('.template-replyto-fieldset')).not.toBeNull();
    expect(more.querySelector('.template-assets')).not.toBeNull();
    // The summary says what is inside, so it is not a mystery drawer.
    expect(more.querySelector('summary').textContent).toMatch(/images/i);
  });

  test('the footer actions are the same size as each other', () => {
    // They match Save in the card head too — all three are 28px, the height
    // of the Edit / Preview tabs Save sits beside.
    mount();
    const btns = [...document.querySelectorAll('.template-actions button')];
    expect(btns).toHaveLength(2);
    btns.forEach((b) => expect(b.className).toMatch(/template-action-btn/));
  });

  test('Save is not duplicated in the footer', () => {
    // It lives in the card head, which is permanently on screen. Having it
    // in both places meant the same action twice, and the copy down here
    // was the one you could not see while typing.
    mount();
    const footer = [...document.querySelectorAll('.template-actions button')]
      .map((b) => b.textContent.trim().toLowerCase());
    expect(footer.some((t) => t.includes('save'))).toBe(false);
    expect(footer.some((t) => t.includes('delete'))).toBe(true);
    expect(footer.some((t) => t.includes('duplicate'))).toBe(true);
  });

  test('every field is still rendered — moved, not removed', () => {
    mount();
    expect(document.querySelector('[placeholder="e.g. Welcome email"]')).not.toBeNull();
    expect(document.querySelector('[placeholder*="quick update"]')).not.toBeNull();
    expect(document.querySelector('[placeholder*="inbox previews"]')).not.toBeNull();
    expect(document.querySelector('.template-replyto-fieldset')).not.toBeNull();
    expect(document.querySelector('.plain-text-details')).not.toBeNull();
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
