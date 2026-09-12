import { useEffect, useState } from 'react';

// The loading indicator.
//
// Nine places in the app rendered the bare string "Loading…" — no motion, no
// indication anything was happening, which at a glance is indistinguishable
// from a page that has finished and has nothing to say.
//
// THE DELAY IS THE POINT. A spinner that appears instantly is worse than no
// spinner on anything that resolves quickly: a request that takes 80ms gets a
// spinner that flashes on and off, which reads as a glitch rather than as
// progress. Below the threshold nothing renders at all and the content simply
// appears; above it, the wait was long enough that the reader needs telling.
// 200ms is roughly where a delay stops feeling instantaneous.
//
// The flip side is that once shown it stays for a minimum spell — otherwise a
// request landing at 210ms produces exactly the flash the delay exists to
// prevent, just later.

const APPEAR_AFTER = 200;
const STAY_FOR = 320;

export function useDelayedFlag(active, appearAfter = APPEAR_AFTER, stayFor = STAY_FOR) {
  const [shown, setShown] = useState(false);
  const [shownAt, setShownAt] = useState(0);

  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        setShown(true);
        setShownAt(Date.now());
      }, appearAfter);
      return () => clearTimeout(timer);
    }
    if (!shown) return undefined;
    const remaining = Math.max(0, stayFor - (Date.now() - shownAt));
    const timer = setTimeout(() => setShown(false), remaining);
    return () => clearTimeout(timer);
  }, [active, shown, shownAt, appearAfter, stayFor]);

  return shown;
}

// The ring on its own, for sitting beside something that already has a label.
export function Spinner({ size = 16, className = '' }) {
  return (
    <span
      className={`spinner ${className}`.trim()}
      style={{ '--spinner-size': `${size}px` }}
      aria-hidden="true"
    />
  );
}

// Ring plus label. `label` is announced; `showLabel` draws it too.
export function Loading({
  label = 'Loading…',
  showLabel = true,
  size = 16,
  delay = APPEAR_AFTER,
  className = '',
}) {
  const visible = useDelayedFlag(true, delay);
  if (!visible) return null;
  return (
    <p className={`loading ${className}`.trim()} role="status">
      <Spinner size={size} />
      {showLabel
        ? <span>{label}</span>
        : <span className="visually-hidden">{label}</span>}
    </p>
  );
}

// The whole-route wait, while a lazy page chunk downloads.
export function LoadingPage({ label = 'Loading…' }) {
  const visible = useDelayedFlag(true);
  if (!visible) return null;
  return (
    <div className="loading-page" role="status">
      <Spinner size={22} />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}
