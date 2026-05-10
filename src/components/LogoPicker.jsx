import { useEffect, useRef, useState } from 'react';
import { Trash2, Upload, X } from 'lucide-react';
import {
  deleteLogoAsset,
  listLogoAssets,
  uploadLogoAsset,
} from '../services/brevoApi';
import { ConfirmDialog } from './ConfirmDialog';

export function LogoPicker({ onSelect, onClose, notify }) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const fileInputRef = useRef(null);

  // Fetch once when the picker opens. Deps deliberately empty — this component
  // is mounted/unmounted via the parent, so a fresh mount = a fresh fetch.
  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const list = await listLogoAssets();
      setAssets(list);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not load logos');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      notify?.('Logo must be under 2MB', 'error');
      return;
    }

    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await uploadLogoAsset({ fileName: file.name, dataUrl: reader.result });
        setAssets((prev) => [result, ...prev]);
        onSelect(result);
        notify?.('Logo uploaded');
      } catch (requestError) {
        notify?.(requestError.response?.data?.error || 'Upload failed', 'error');
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  }

  function handleDelete(asset, event) {
    event.stopPropagation();
    setConfirm({
      title: `Delete image "${asset.fileName}"?`,
      message: 'The image will be removed from your library. Templates that already reference its URL will show a broken image.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await deleteLogoAsset(asset.id);
          setAssets((prev) => prev.filter((item) => item.id !== asset.id));
          notify?.('Image deleted');
        } catch (requestError) {
          notify?.(requestError.response?.data?.error || 'Delete failed', 'error');
        }
      },
    });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Image library">
      <div className="modal-card logo-picker-card surface">
        <div className="logo-picker-header">
          <div>
            <h2>Image library</h2>
            <span className="muted">{assets.length} saved · click an image to insert it into your HTML</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="logo-picker-actions">
          <label className="primary upload-button">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={handleUpload}
              disabled={uploading}
            />
            <Upload size={14} aria-hidden="true" />
            {uploading ? 'Uploading…' : 'Upload new'}
          </label>
          <span className="muted">PNG, JPEG, GIF or WEBP · 2MB max</span>
        </div>

        {error ? (
          <p className="empty-state error" role="alert">
            {error} <button type="button" className="text-button" onClick={refresh}>Retry</button>
          </p>
        ) : loading ? (
          <p className="empty-state">Loading library…</p>
        ) : assets.length === 0 ? (
          <p className="empty-state">No images uploaded yet. Click &quot;Upload new&quot; to add one.</p>
        ) : (
          <ul className="logo-grid">
            {assets.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  className="logo-tile"
                  onClick={() => onSelect(asset)}
                >
                  <img src={asset.url} alt={asset.fileName} loading="lazy" />
                  <span className="logo-meta">
                    <span className="logo-name">{asset.fileName}</span>
                    <span className="muted">{Math.round(asset.bytes / 1024)} KB</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="logo-delete danger"
                  onClick={(event) => handleDelete(asset, event)}
                  aria-label={`Delete ${asset.fileName}`}
                >
                  <Trash2 size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>Done</button>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          {...confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await confirm.onConfirm();
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}
