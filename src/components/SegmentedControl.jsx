export function SegmentedControl({ value, options, onChange }) {
  return (
    <div className="segmented-control">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            className={value === option.value ? 'active' : ''}
            onClick={() => onChange(option.value)}
            type="button"
          >
            <Icon size={15} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
