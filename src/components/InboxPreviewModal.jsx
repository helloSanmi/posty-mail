import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { EmailPreview } from './EmailPreview';
import {
  SAMPLE_PREVIEW_CONTACT,
  buildEmailPreviewDocument,
  mergePreview,
} from '../utils/emailPreview';

// Modal-launched inbox preview used from the Builder. The Templates page has
// its own inline EmailPreview; this wrapper layers on the merge-with-sample-
// contact step, the modal chrome, and the client/device/dark toggles in one
// self-contained popover so the Builder doesn't have to manage all that
// state itself.
export function InboxPreviewModal({ template, sampleContact, onClose }) {
  const [previewClient, setPreviewClient] = useState('gmail');
  const [previewDevice, setPreviewDevice] = useState('desktop');
  const [previewDark, setPreviewDark] = useState(false);

  // Close on Escape, restore focus on unmount. Standard modal accessibility.
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const contact = sampleContact || SAMPLE_PREVIEW_CONTACT;
  const subject = useMemo(() => mergePreview(template?.subject || '', contact), [template?.subject, contact]);
  const renderedHtml = useMemo(() => mergePreview(template?.html || '', contact), [template?.html, contact]);
  const previewHtml = useMemo(
    () => buildEmailPreviewDocument(renderedHtml, previewClient, { dark: previewDark }),
    [renderedHtml, previewClient, previewDark],
  );

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Inbox preview"
      onClick={(event) => {
        // Click outside the card closes. Use currentTarget so clicks inside
        // the modal card don't bubble-close.
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="modal-card inbox-preview-card">
        <div className="inbox-preview-head">
          <div>
            <h2>Inbox preview</h2>
            <p className="muted">
              Showing how this would render for{' '}
              <strong>{contact.firstname}{contact.lastname ? ` ${contact.lastname}` : ''}</strong>{' '}
              <code>{contact.email}</code>. Merge tags use sample values.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close preview">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <EmailPreview
          subject={subject}
          previewClient={previewClient}
          setPreviewClient={setPreviewClient}
          previewDevice={previewDevice}
          setPreviewDevice={setPreviewDevice}
          previewHtml={previewHtml}
          previewDark={previewDark}
          setPreviewDark={setPreviewDark}
        />
      </div>
    </div>
  );
}
