import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// Shared modal shell. Every dialog in the app goes through this.
//
// WHY A PORTAL, AND WHY THIS EXISTS AT ALL
//
// `.surface` animates in with `animation: posty-slide-up ... both`, and the
// `both` fill mode makes the final keyframe stick — so a card keeps
// `transform: translateY(0)` (computed: matrix(1,0,0,1,0,0)) forever. Any
// transform other than `none` makes an element the containing block for its
// `position: fixed` descendants, so a `.modal-backdrop` rendered inside a
// card was sized and positioned against THAT CARD instead of the viewport.
//
// In the Groups sidebar that meant "New group" rendered as a 258px-wide,
// 46px-tall strip inside the rail rather than a centred dialog. The same
// trap hit the contacts table (edit contact, delete confirm), the role
// editor, and the template editor's three pickers. Rendering into
// document.body puts every dialog outside the reach of any ancestor's
// transform, permanently — including ones added later, which is the part
// static review cannot catch.
//
// It also fixes what the old per-modal copies each got slightly wrong:
//
//   - Tall modals were unreachable. The backdrop was a centred flexbox with
//     no overflow, so a card taller than the viewport had its header clipped
//     above the top edge and its submit button below the bottom one, with
//     nothing scrollable. `align-items: flex-start` plus `margin: auto` on
//     the card centres it when there is room and scrolls when there is not.
//   - Focus was stolen mid-typing. Each modal ran
//     `cancelRef.current?.focus()` in an effect keyed on `[onCancel]`, and
//     callers pass an inline arrow, so any parent re-render re-ran it and
//     yanked focus back to the Cancel button. Initial focus is set once here.
//   - Focus escaped. Tab walked straight out into the page behind the
//     dialog; nothing brought it back, and nothing restored the caller's
//     focus on close.
//   - The page scrolled behind the dialog.
//
// Stacking is real (the image library opens a delete confirm), so Escape and
// backdrop clicks act on the TOP dialog only, and the scroll lock is
// reference counted.

// Open dialogs, innermost last.
const openModals = [];

// Body scroll lock, reference counted so closing an inner dialog does not
// unlock the page while an outer one is still open. The padding swap keeps
// the page from jumping sideways as the scrollbar disappears.
let savedBodyStyle = null;

function lockBodyScroll() {
  if (openModals.length !== 1) return;
  const { body } = document;
  const gutter = window.innerWidth - document.documentElement.clientWidth;
  savedBodyStyle = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  body.style.overflow = 'hidden';
  if (gutter > 0) body.style.paddingRight = `${gutter}px`;
}

function unlockBodyScroll() {
  if (openModals.length !== 0 || !savedBodyStyle) return;
  document.body.style.overflow = savedBodyStyle.overflow;
  document.body.style.paddingRight = savedBodyStyle.paddingRight;
  savedBodyStyle = null;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => {
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
    // checkVisibility is the precise answer (it accounts for display:none,
    // visibility and content-visibility on every ancestor). Environments
    // without layout do not implement it, so there everything the selector
    // matched counts as focusable rather than nothing doing.
    if (typeof el.checkVisibility === 'function') return el.checkVisibility();
    return true;
  });
}

export function Modal({
  label,
  onClose,
  className = '',
  as: As = 'div',
  // The inbox preview paints its own card (its own background and padding),
  // so it opts out rather than stacking `.surface` on top of that.
  surface = true,
  // Defaults to TRUE: pressing outside a dialog closes it, everywhere.
  //
  // It used to default to false, on the reasoning that a stray click beside a
  // half-filled form would throw the input away. That is a real cost, but it
  // was being paid on every dialog in the app to avoid it on a few — and
  // clicking away is the first thing people try, so the dialogs that did not
  // respond read as stuck rather than as careful.
  //
  // The guard against the stray click is below: a press only counts when it
  // both STARTS and ENDS on the backdrop itself, so releasing a text
  // selection that began inside the dialog does not dismiss it.
  closeOnBackdrop = true,
  // 'center' (default) or 'side'. A side panel is the same dialog — same
  // portal, same focus trap, same scroll lock, same stacking — pinned to the
  // right edge instead of centred. Sharing the implementation matters more
  // than the twenty lines it saves: a second dialog built from scratch is a
  // second place for the transform/containing-block trap described above to
  // come back.
  variant = 'center',
  initialFocus,
  children,
  ...rest
}) {
  const cardRef = useRef(null);
  const tokenRef = useRef({});
  // Captured before focus moves into the dialog, so it can go back where it
  // came from on close.
  const returnFocusRef = useRef(null);

  useEffect(() => {
    const token = tokenRef.current;
    returnFocusRef.current = document.activeElement;
    openModals.push(token);
    lockBodyScroll();

    // Prefer the first real field: a form dialog should open ready to type,
    // not ready to cancel. Callers wanting otherwise (a destructive confirm
    // should not open with Delete under the cursor) pass initialFocus.
    const card = cardRef.current;
    const target = initialFocus?.current
      || card?.querySelector('input:not([type="hidden"]):not([disabled]), select, textarea')
      || focusableWithin(card)[0]
      || card;
    target?.focus?.();

    return () => {
      const index = openModals.indexOf(token);
      if (index >= 0) openModals.splice(index, 1);
      unlockBodyScroll();
      const back = returnFocusRef.current;
      if (back?.isConnected && typeof back.focus === 'function') back.focus();
    };
    // Mount-once on purpose. Re-running this on a changed `onClose` identity
    // is what used to steal focus from whatever the user was typing in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      // Only the top dialog reacts, so an inner confirm closes itself and
      // leaves its opener standing.
      if (openModals[openModals.length - 1] !== tokenRef.current) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
        return;
      }

      if (event.key !== 'Tab') return;
      const items = focusableWithin(cardRef.current);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Wrap at the ends, and pull focus back in if it has already escaped
      // into the page behind.
      if (!cardRef.current?.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function onBackdropMouseDown(event) {
    if (!closeOnBackdrop) return;
    // Only a press that both starts and lands on the backdrop itself counts.
    // Without the target check, releasing a text selection that began inside
    // the card would close the dialog and discard the edit.
    if (event.target !== event.currentTarget) return;
    if (openModals[openModals.length - 1] !== tokenRef.current) return;
    onClose?.();
  }

  return createPortal(
    <div
      className={`modal-backdrop${variant === 'side' ? ' is-side' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onMouseDown={onBackdropMouseDown}
    >
      <As
        ref={cardRef}
        className={['modal-card', surface ? 'surface' : '', className].filter(Boolean).join(' ')}
        {...rest}
      >
        {children}
      </As>
    </div>,
    document.body,
  );
}
