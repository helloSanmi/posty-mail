import { useRef } from 'react';
import { Modal } from './Modal';

// Yes/no dialog. Used for every destructive action in the app, and opened
// from inside other dialogs (the image library's delete), which is why Modal
// tracks a stack rather than assuming one dialog at a time.
//
// Focus goes to Cancel, not to the confirm button: these are mostly deletes,
// and a dialog that opens with Delete under a waiting Enter key is a trap.
// That is the one case where Modal's default of "focus the first field" is
// wrong, so it is passed explicitly.
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);

  return (
    <Modal label={title} onClose={onCancel} initialFocus={cancelRef} closeOnBackdrop>
      <h2>{title}</h2>
      {message && <p className="muted">{message}</p>}
      <div className="modal-actions">
        <button ref={cancelRef} type="button" onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className={confirmVariant} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
