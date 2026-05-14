import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  getUnsubscribeCategories,
  saveUnsubscribeCategories,
} from '../../services/brevoApi';
import { StatusPill } from './StatusPill';

// Admin editor for the preference-center category list. Each row defines a
// topic (id + label + optional description) that the public /unsubscribe
// page renders as a checkbox so recipients can selectively unsubscribe
// rather than leaving entirely. Empty list = legacy all-or-nothing flow.
export function PreferenceCenterCard({ notify }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getUnsubscribeCategories()
      .then((list) => {
        if (cancelled) return;
        setCategories(list);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setCategories([]);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  function update(index, patch) {
    setCategories((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function addCategory() {
    setCategories((prev) => [...prev, { id: '', label: '', description: '' }]);
  }

  function removeCategory(index) {
    setCategories((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    // Drop empty rows; the server also validates schema, this is just the
    // user-visible feedback that empty rows didn't make it.
    const cleaned = categories
      .map((c) => ({
        id: String(c.id || '').trim(),
        label: String(c.label || '').trim(),
        description: String(c.description || '').trim(),
      }))
      .filter((c) => c.id && c.label);
    if (cleaned.length !== categories.length) {
      setCategories(cleaned);
    }
    setSaving(true);
    try {
      const saved = await saveUnsubscribeCategories(cleaned);
      setCategories(saved);
      notify?.(saved.length
        ? 'Preference center categories saved'
        : 'Preference center disabled (no categories)');
    } catch (error) {
      notify?.(error.response?.data?.error || 'Could not save categories', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="surface settings-card">
      <div className="settings-card-head">
        <div>
          <h3>Preference center</h3>
          <p className="muted">
            Define topics so recipients can selectively re-subscribe instead
            of leaving entirely. Categories show as checkboxes on your
            unsubscribe page. Leave empty to keep the legacy
            all-or-nothing flow.
          </p>
        </div>
        <StatusPill
          ok={categories.length > 0}
          okLabel={`${categories.length} ${categories.length === 1 ? 'category' : 'categories'}`}
          emptyLabel="Not configured"
        />
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {categories.length === 0 ? (
            <p className="muted preference-empty">
              No categories yet. Click <strong>Add category</strong> to start.
            </p>
          ) : (
            <ul className="preference-list">
              {categories.map((category, index) => (
                <li key={index} className="preference-row">
                  <input
                    value={category.id}
                    onChange={(event) => update(index, { id: event.target.value })}
                    placeholder="newsletter"
                    aria-label="Category id"
                    className="preference-id"
                  />
                  <input
                    value={category.label}
                    onChange={(event) => update(index, { label: event.target.value })}
                    placeholder="Weekly newsletter"
                    aria-label="Category label"
                    className="preference-label"
                  />
                  <input
                    value={category.description || ''}
                    onChange={(event) => update(index, { description: event.target.value })}
                    placeholder="Short helper text shown under the label (optional)"
                    aria-label="Category description"
                    className="preference-description"
                  />
                  <button
                    type="button"
                    onClick={() => removeCategory(index)}
                    aria-label={`Remove ${category.label || category.id}`}
                    className="preference-remove"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="preference-actions">
            <button type="button" onClick={addCategory}>
              <Plus size={14} aria-hidden="true" /> Add category
            </button>
            <button type="button" className="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save categories'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
