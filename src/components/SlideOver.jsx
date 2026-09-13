import { X } from 'lucide-react';
import { Modal } from './Modal';

// A right-edge panel with a fixed header and a footer that stays put while
// the body scrolls.
//
// It is Modal underneath, not a second dialog implementation — same portal,
// same focus trap, same scroll lock, same stacking. Only the placement and
// the internal chrome differ.
//
// The shape exists for edits that BELONG to the page behind them. Changing
// your password or your name is a side task on your profile: a centred modal
// covers the record you are editing and reads like an interruption, and the
// alternative this replaced — leaving the fields permanently open on the page
// — makes a page you came to read look like a form you are expected to fill
// in. A panel keeps the page visible and the task obviously separate.
export function SlideOver({
  label, description, onClose, footer, children, ...rest
}) {
  return (
    <Modal
      label={label}
      onClose={onClose}
      variant="side"
      className="slideover"
      {...rest}
    >
      <header className="slideover-head">
        <div className="slideover-heading">
          <h2>{label}</h2>
          {description && <p className="muted">{description}</p>}
        </div>
        <button
          type="button"
          className="sm-icon-btn"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {/* The body is the only scroller, so the header stays readable and the
          footer's primary action never scrolls out of reach on a short
          screen — which is the usual failure of a full-height panel. */}
      <div className="slideover-body">{children}</div>

      {footer && <footer className="slideover-foot">{footer}</footer>}
    </Modal>
  );
}
