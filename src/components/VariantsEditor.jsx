import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';

const MAX_VARIANTS = 4;

export function VariantsEditor({ variants, onChange, baseTemplate }) {
  const enabled = Array.isArray(variants) && variants.length > 0;

  function addVariant() {
    const id = `v${(variants?.length || 0) + 1}`;
    const next = [
      ...(variants || []),
      {
        id,
        label: `Variant ${id.toUpperCase()}`,
        subject: baseTemplate?.subject || '',
        weight: 1,
      },
    ];
    onChange(next);
  }

  function removeVariant(index) {
    onChange(variants.filter((_, i) => i !== index));
  }

  function updateVariant(index, patch) {
    onChange(variants.map((variant, i) => (i === index ? { ...variant, ...patch } : variant)));
  }

  if (!enabled) {
    return (
      <button type="button" className="text-button add-variant-cta" onClick={addVariant}>
        <Plus size={14} aria-hidden="true" /> Add A/B subject variant
      </button>
    );
  }

  return (
    <div className="variants-editor">
      <div className="variants-header">
        <strong>A/B subject variants</strong>
        <button type="button" className="text-button" onClick={() => onChange([])}>
          Disable A/B
        </button>
      </div>
      {variants.map((variant, index) => (
        <VariantRow
          key={variant.id || index}
          index={index}
          variant={variant}
          onChange={(patch) => updateVariant(index, patch)}
          onRemove={() => removeVariant(index)}
          canRemove={variants.length > 1}
        />
      ))}
      {variants.length < MAX_VARIANTS && (
        <button type="button" onClick={addVariant} className="add-variant">
          <Plus size={14} aria-hidden="true" /> Add another variant
        </button>
      )}
    </div>
  );
}

function VariantRow({ index, variant, onChange, onRemove, canRemove }) {
  const labelId = useId();
  const subjectId = useId();
  const weightId = useId();

  return (
    <div className="variant-row">
      <div className="variant-fields">
        <div>
          <label htmlFor={labelId}>Label</label>
          <input
            id={labelId}
            value={variant.label || ''}
            onChange={(event) => onChange({ label: event.target.value })}
            placeholder={`Variant ${index + 1}`}
          />
        </div>
        <div className="variant-subject-field">
          <label htmlFor={subjectId}>Subject (overrides template subject)</label>
          <input
            id={subjectId}
            value={variant.subject || ''}
            onChange={(event) => onChange({ subject: event.target.value })}
            placeholder="Subject line for this variant"
          />
        </div>
        <div className="variant-weight-field">
          <label htmlFor={weightId}>Weight</label>
          <input
            id={weightId}
            type="number"
            min={1}
            max={100}
            value={variant.weight ?? 1}
            onChange={(event) => onChange({ weight: Number(event.target.value) || 1 })}
          />
        </div>
      </div>
      {canRemove && (
        <button
          type="button"
          className="danger"
          onClick={onRemove}
          aria-label={`Remove variant ${index + 1}`}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
