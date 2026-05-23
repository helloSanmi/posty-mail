// Horizontal funnel: Sent → Opened → Clicked. Each bar is scaled to a
// percentage of Sent and shows raw count + drop-off rate. Reads as the
// answer to "how far through engagement do recipients get?" at a glance.
// Same engagement signal the KPI rates carry, but visualized as a
// single drop-off pattern.

export function EngagementFunnel({ sent, opens, clicks }) {
  if (!sent) {
    return <p className="empty-state compact">No sends in this window.</p>;
  }
  const steps = [
    { label: 'Sent', value: sent, tone: 'neutral' },
    { label: 'Opened', value: opens, tone: 'good' },
    { label: 'Clicked', value: clicks, tone: 'great' },
  ];
  return (
    <div className="funnel">
      {steps.map((step, index) => {
        const percentOfSent = ((step.value / sent) * 100).toFixed(1);
        // Drop-off vs the previous step. First step has no predecessor;
        // show "—" instead of a misleading 100%.
        const prev = index > 0 ? steps[index - 1].value : null;
        const dropOffPercent = prev != null && prev > 0
          ? (100 - (step.value / prev) * 100).toFixed(1)
          : null;
        return (
          <div key={step.label} className="funnel-row">
            <div className="funnel-row-head">
              <span className="funnel-row-label">{step.label}</span>
              <span className="funnel-row-value">{step.value.toLocaleString()}</span>
            </div>
            <div
              className={`funnel-bar funnel-bar-${step.tone}`}
              role="progressbar"
              aria-valuenow={Number(percentOfSent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${step.label}: ${percentOfSent}% of sent`}
            >
              <div
                className="funnel-bar-fill"
                style={{ width: `${percentOfSent}%` }}
              />
              <span className="funnel-bar-percent">{percentOfSent}%</span>
            </div>
            {dropOffPercent != null && (
              <span className="funnel-row-drop muted">
                {dropOffPercent}% dropped off
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
