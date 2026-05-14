import { CheckCircle2 } from 'lucide-react';

// Small green / muted pill used on every Settings card's header to signal
// "configured" or "not yet." Kept here so every card imports it from the
// same place instead of redefining it inline.
export function StatusPill({ ok, okLabel, emptyLabel }) {
  return (
    <span className={`pill ${ok ? 'green' : 'muted'} settings-status-pill`}>
      {ok && <CheckCircle2 size={12} aria-hidden="true" />}
      {ok ? okLabel : emptyLabel}
    </span>
  );
}
