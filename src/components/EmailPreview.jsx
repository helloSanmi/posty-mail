import { Monitor, Moon, Smartphone, Sun, Tablet } from 'lucide-react';
import { SegmentedControl } from './SegmentedControl';
import { previewClientLabels } from '../utils/emailPreview';

export function EmailPreview({
  subject,
  previewClient,
  setPreviewClient,
  previewDevice,
  setPreviewDevice,
  previewHtml,
  // Optional dark-mode toggle. When `setPreviewDark` is omitted the toggle is
  // hidden so legacy callers (templates page) keep their original layout.
  previewDark,
  setPreviewDark,
}) {
  const showDarkToggle = typeof setPreviewDark === 'function';
  return (
    <div className="surface email-preview">
      <div className="preview-header">
        <div>
          <h2>Preview</h2>
          <p>{previewClientLabels[previewClient]}{previewDark ? ' · dark' : ''}</p>
        </div>
        <div className="preview-toolbar">
          <SegmentedControl
            value={previewDevice}
            options={[
              { value: 'desktop', label: 'Computer', icon: Monitor },
              { value: 'tablet', label: 'Tablet', icon: Tablet },
              { value: 'mobile', label: 'Phone', icon: Smartphone },
            ]}
            onChange={setPreviewDevice}
          />
          <select
            value={previewClient}
            onChange={(event) => setPreviewClient(event.target.value)}
            aria-label="Mail client"
          >
            <option value="gmail">Gmail</option>
            <option value="outlook">Outlook</option>
            <option value="apple">Apple Mail</option>
          </select>
          {showDarkToggle && (
            <button
              type="button"
              className="preview-dark-toggle"
              onClick={() => setPreviewDark(!previewDark)}
              aria-pressed={Boolean(previewDark)}
              title={previewDark ? 'Switch to light-mode preview' : 'Switch to dark-mode preview'}
            >
              {previewDark
                ? <Sun size={14} aria-hidden="true" />
                : <Moon size={14} aria-hidden="true" />}
              {previewDark ? 'Light' : 'Dark'}
            </button>
          )}
        </div>
      </div>
      {/* Subject preview. Styled like an inbox row header. When the template
          has no subject yet, render a muted placeholder rather than an
          empty pill (which floats with just padding and looks like a UI bug). */}
      <div className={`preview-subject${subject ? '' : ' is-empty'}`}>
        <span className="preview-subject-label muted">Subject</span>
        <span className="preview-subject-text">
          {subject || <span className="muted">No subject yet — set one in the Subject field above.</span>}
        </span>
      </div>
      <div className={`email-device ${previewDevice}`}>
        <iframe
          className="message-frame"
          title="Email preview"
          sandbox=""
          srcDoc={previewHtml}
        />
      </div>
    </div>
  );
}
