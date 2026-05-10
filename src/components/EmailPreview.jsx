import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { SegmentedControl } from './SegmentedControl';
import { previewClientLabels } from '../utils/emailPreview';

export function EmailPreview({
  subject,
  previewClient,
  setPreviewClient,
  previewDevice,
  setPreviewDevice,
  previewHtml,
}) {
  return (
    <div className="surface email-preview">
      <div className="preview-header">
        <div>
          <h2>Preview</h2>
          <p>{previewClientLabels[previewClient]}</p>
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
          >
            <option value="gmail">Gmail</option>
            <option value="outlook">Outlook</option>
            <option value="apple">Apple Mail</option>
          </select>
        </div>
      </div>
      <div className="preview-subject">{subject}</div>
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
