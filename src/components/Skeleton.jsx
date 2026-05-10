export function SkeletonRow() {
  return (
    <div className="skeleton-row" aria-hidden="true">
      <span className="skeleton skeleton-line" style={{ width: 16, height: 16 }} />
      <span className="skeleton" style={{ borderRadius: '50%', height: 38, width: 38 }} />
      <span>
        <span className="skeleton skeleton-line long" style={{ marginBottom: 6 }} />
        <span className="skeleton skeleton-line short" />
      </span>
      <span className="skeleton skeleton-line short" />
      <span className="skeleton skeleton-line short" />
    </div>
  );
}

export function SkeletonList({ rows = 4 }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">Loading…</span>
      {Array.from({ length: rows }).map((_, index) => <SkeletonRow key={index} />)}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <span className="skeleton skeleton-line short" style={{ marginBottom: 10 }} />
      <span className="skeleton skeleton-line long" style={{ marginBottom: 6 }} />
      <span className="skeleton skeleton-line short" />
    </div>
  );
}
