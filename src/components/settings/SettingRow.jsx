// One setting as a row: what it is on the left, what it is currently set to
// underneath, its state and controls on the right.
//
// This replaces the previous pattern where every setting was its own
// bordered card with an h3, a muted sentence explaining itself and a status
// pill — four of those stacked in Connections put four headings at the same
// weight and re-explained things the value already showed. A row that reads
// "Sender / hello@usecomplier.com" needs no caption saying what a sender is.
//
// `value` is the current setting, shown muted under the name. `state` is a
// <RowState> (or any node) pinned right. `children` is an optional detail
// area that renders full-width under the row — used for the edit form and
// for the raw DNS records, so long content has somewhere to go without a
// paragraph in the flow.
export function SettingRow({
  name, value, state, actions, children, mono = false,
}) {
  return (
    <div className="setting-row">
      <div className="setting-row-main">
        <div className="setting-row-label">
          <span className="setting-row-name">{name}</span>
          {value && (
            <span className={`setting-row-value${mono ? ' is-mono' : ''}`}>{value}</span>
          )}
        </div>
        {(state || actions) && (
          <div className="setting-row-side">
            {state}
            {actions}
          </div>
        )}
      </div>
      {children && <div className="setting-row-detail">{children}</div>}
    </div>
  );
}

// The state of one row, as a pill. `tone` is semantic, not decorative:
// 'ok' / 'warn' / 'bad' / 'off', where 'off' means "not set up" rather than
// "broken" — the distinction the old muted pill collapsed.
export function RowState({ tone = 'off', children }) {
  return (
    <span className={`setting-state setting-state-${tone}`}>
      <span className="setting-state-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

// Groups rows under one heading inside a single surface. The heading is the
// only h3 in the group, so a section reads as one thing instead of as three
// competing cards.
export function SettingGroup({
  title, state, action, children,
}) {
  return (
    <section className="surface settings-group">
      <div className="settings-group-head">
        <h3>{title}</h3>
        <div className="settings-group-side">
          {state}
          {action}
        </div>
      </div>
      <div className="setting-rows">{children}</div>
    </section>
  );
}
