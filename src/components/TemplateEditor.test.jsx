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

  test('More settings is shut on load and says what is inside', () => {
    mount();
    expect(document.querySelector('.template-more-body')).toBeNull();
    const toggle = document.querySelector('.template-more-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Not a mystery drawer.
    expect(toggle.textContent).toMatch(/images/i);
    expect(toggle.textContent).toMatch(/reply-to/i);
  });

  test('it opens in the flow, as one band beside the fields', () => {
    // It was briefly a panel floating over the canvas. In the flow it is
    // not a trap, so it needs no outside-press or Escape dismissal — it
    // closes with the control that opened it, like any other section.
    mount();
    fireEvent.click(document.querySelector('.template-more-toggle'));
    const body = document.querySelector('.template-more-body');
    expect(body).not.toBeNull();
    // Reply-to and both inspectors are siblings in one row, not stacked.
    expect(body.querySelector('.template-replyto-fieldset')).not.toBeNull();
    expect(body.querySelectorAll('.template-asset-group').length).toBeGreaterThan(0);
    // The inspectors scroll rather than setting the band's height — the
    // band should be as tall as its tallest NECESSARY thing, not as tall as
    // its longest list.
    body.querySelectorAll('.template-asset-list').forEach((list) => {
      expect(list.closest('.template-asset-group')).not.toBeNull();
    });
  });

  test('opening it reveals the fields and the inspectors', () => {
    mount();
    fireEvent.click(document.querySelector('.template-more-toggle'));
    const body = document.querySelector('.template-more-body');
    expect(body).not.toBeNull();
    expect(body.querySelector('.template-replyto-fieldset')).not.toBeNull();
    expect(body.querySelector('.template-assets')).not.toBeNull();
    expect(document.querySelector('.template-more-toggle').getAttribute('aria-expanded')).toBe('true');
  });

  test('every field is still reachable — moved, not removed', () => {
    mount();
    // On the surface, above the canvas.
    expect(document.querySelector('[placeholder="e.g. Welcome email"]')).not.toBeNull();
    expect(document.querySelector('[placeholder*="quick update"]')).not.toBeNull();
    expect(document.querySelector('[placeholder*="inbox previews"]')).not.toBeNull();
    expect(document.querySelector('.plain-text-details')).not.toBeNull();

    // One press away. The panel UNMOUNTS when shut rather than hiding — the
    // values live on the `template` object held by the page, so nothing is
    // lost by not being in the DOM, and an absolutely-positioned panel that
    // is merely hidden still costs layout and can still be tabbed into.
    fireEvent.click(document.querySelector('.template-more-toggle'));
    expect(document.querySelector('.template-replyto-fieldset')).not.toBeNull();
    expect(document.querySelector('.template-assets')).not.toBeNull();
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
