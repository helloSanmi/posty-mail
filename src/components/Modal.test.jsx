// Modal is the shell every dialog in the app now goes through, so these
// pin the behaviours that were previously hand-rolled (and subtly different)
// in twelve places — plus the one that was outright broken.
import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './Modal';

beforeEach(() => {
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
});

describe('Modal', () => {
  // THE bug. `.surface` used to keep a transform after its entrance
  // animation, and a transformed ancestor becomes the containing block for
  // `position: fixed` descendants — so a dialog rendered inside a card was
  // sized against the card, not the viewport. In the Groups rail that made
  // "New group" a 258x46 strip. Portaling to <body> is what stops any
  // ancestor from being able to do that again.
  it('renders into document.body, not inside the calling component', () => {
    const { container } = render(
      <div className="surface">
        <Modal label="New group"><p>body</p></Modal>
      </div>,
    );
    // Nothing but the wrapper stays behind in the caller's subtree.
    expect(container.querySelector('.modal-backdrop')).toBeNull();
    const backdrop = document.body.querySelector('.modal-backdrop');
    expect(backdrop).not.toBeNull();
    expect(backdrop.closest('.surface')).toBeNull();
    expect(backdrop.parentElement).toBe(document.body);
  });

  it('marks itself up as a modal dialog', () => {
    render(<Modal label="New group"><p>body</p></Modal>);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'New group');
  });

  it('closes on Escape', () => {
    let closed = 0;
    render(<Modal label="D" onClose={() => { closed += 1; }}><p>body</p></Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closed).toBe(1);
  });

  it('closes on a backdrop press by default', () => {
    // The default used to be the other way, on the reasoning that a stray
    // click beside a half-filled form would throw the input away. That cost
    // was being paid on every dialog to avoid it on a few — and pressing
    // outside is the first thing people try, so the ones that did not
    // respond read as stuck rather than as careful.
    let closed = 0;
    render(<Modal label="D" onClose={() => { closed += 1; }}><p>body</p></Modal>);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(closed).toBe(1);
  });

  it('can still be opted OUT, for a dialog that must not be dismissed', () => {
    let closed = 0;
    render(
      <Modal label="D" onClose={() => { closed += 1; }} closeOnBackdrop={false}>
        <p>body</p>
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(closed).toBe(0);
  });

  it('closes on a backdrop press when the dialog opts in explicitly', () => {
    let closed = 0;
    render(
      <Modal label="D" onClose={() => { closed += 1; }} closeOnBackdrop>
        <p>body</p>
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(closed).toBe(1);
  });

  it('ignores an opted-in press that started inside the card', () => {
    // Releasing a text selection that began in the card must not throw the
    // dialog away along with whatever was being edited.
    let closed = 0;
    render(
      <Modal label="D" onClose={() => { closed += 1; }} closeOnBackdrop>
        <p>drag from here</p>
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByText('drag from here'));
    expect(closed).toBe(0);
  });

  describe('focus', () => {
    it('opens on the first field, not on Cancel', () => {
      // Every old copy focused its Cancel button, so a form dialog opened
      // one Tab away from being usable.
      render(
        <Modal label="Add contact">
          <input aria-label="Email" />
          <button type="button">Cancel</button>
        </Modal>,
      );
      expect(screen.getByLabelText('Email')).toHaveFocus();
    });

    it('lets the caller override the target', () => {
      function Harness() {
        const ref = { current: null };
        return (
          <Modal label="Delete?" initialFocus={ref}>
            <button type="button" ref={(el) => { ref.current = el; }}>Cancel</button>
            <button type="button" className="danger">Delete</button>
          </Modal>
        );
      }
      render(<Harness />);
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });

    it('returns focus to whatever opened it', () => {
      function Harness({ open }) {
        return (
          <>
            <button type="button">Opener</button>
            {open && <Modal label="D"><input aria-label="Field" /></Modal>}
          </>
        );
      }
      const { rerender } = render(<Harness open={false} />);
      const opener = screen.getByRole('button', { name: 'Opener' });
      opener.focus();
      expect(opener).toHaveFocus();

      rerender(<Harness open />);
      expect(screen.getByLabelText('Field')).toHaveFocus();

      rerender(<Harness open={false} />);
      expect(opener).toHaveFocus();
    });

    it('pulls Tab back in when focus has escaped the dialog', () => {
      render(
        <>
          <button type="button">Behind</button>
          <Modal label="D">
            <input aria-label="First" />
            <button type="button">Last</button>
          </Modal>
        </>,
      );
      const behind = screen.getByRole('button', { name: 'Behind' });
      behind.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(screen.getByLabelText('First')).toHaveFocus();
    });

    it('wraps Tab at the end and Shift+Tab at the start', () => {
      render(
        <Modal label="D">
          <input aria-label="First" />
          <button type="button">Last</button>
        </Modal>,
      );
      const first = screen.getByLabelText('First');
      const last = screen.getByRole('button', { name: 'Last' });

      last.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(first).toHaveFocus();

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(last).toHaveFocus();
    });
  });

  describe('body scroll lock', () => {
    it('locks while open and restores on close', () => {
      const { unmount } = render(<Modal label="D"><p>body</p></Modal>);
      expect(document.body.style.overflow).toBe('hidden');
      unmount();
      expect(document.body.style.overflow).toBe('');
    });

    it('stays locked until the last of several dialogs closes', () => {
      // The image library opens a delete confirm on top of itself; closing
      // the confirm must not hand the page back its scrollbar.
      function Harness({ inner }) {
        return (
          <>
            <Modal label="Library"><p>outer</p></Modal>
            {inner && <Modal label="Delete?"><p>inner</p></Modal>}
          </>
        );
      }
      const { rerender, unmount } = render(<Harness inner />);
      expect(document.body.style.overflow).toBe('hidden');
      rerender(<Harness inner={false} />);
      expect(document.body.style.overflow).toBe('hidden');
      unmount();
      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('stacking', () => {
    it('Escape closes only the top dialog', () => {
      const closed = [];
      render(
        <>
          <Modal label="Library" onClose={() => closed.push('outer')}><p>outer</p></Modal>
          <Modal label="Delete?" onClose={() => closed.push('inner')}><p>inner</p></Modal>
        </>,
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(closed).toEqual(['inner']);
    });

    it('a backdrop press reaches only the top dialog', () => {
      const closed = [];
      render(
        <>
          <Modal label="Library" onClose={() => closed.push('outer')} closeOnBackdrop>
            <p>outer</p>
          </Modal>
          <Modal label="Delete?" onClose={() => closed.push('inner')} closeOnBackdrop>
            <p>inner</p>
          </Modal>
        </>,
      );
      const dialogs = screen.getAllByRole('dialog');
      fireEvent.mouseDown(dialogs[0]);
      expect(closed).toEqual([]);
      fireEvent.mouseDown(dialogs[1]);
      expect(closed).toEqual(['inner']);
    });
  });

  describe('card element', () => {
    it('carries .modal-card.surface plus the caller class', () => {
      render(<Modal label="D" className="user-modal"><p>body</p></Modal>);
      const card = document.body.querySelector('.modal-card');
      expect(card.className).toBe('modal-card surface user-modal');
    });

    it('can opt out of .surface for a card that paints itself', () => {
      render(<Modal label="D" surface={false} className="inbox-preview-card"><p>b</p></Modal>);
      const card = document.body.querySelector('.modal-card');
      expect(card.className).toBe('modal-card inbox-preview-card');
    });

    it('can be a form so the dialog submits natively', () => {
      let submitted = 0;
      render(
        <Modal label="D" as="form" onSubmit={(e) => { e.preventDefault(); submitted += 1; }}>
          <button type="submit">Save</button>
        </Modal>,
      );
      const card = document.body.querySelector('.modal-card');
      expect(card.tagName).toBe('FORM');
      fireEvent.submit(card);
      expect(submitted).toBe(1);
    });
  });
});
