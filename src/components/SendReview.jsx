export function SendReview({ readyContacts, template, frequency, held, batches }) {
  return (
    <aside className="surface send-summary">
      <h2 className="review-title">Review</h2>
      <dl className="review-list">
        <ReviewItem label="Audience" value={readyContacts ? `${readyContacts} people` : 'No audience'} />
        <ReviewItem label="Email" value={template.name || 'Selected email'} />
        <ReviewItem label="Repeat" value={frequency === 'once' ? 'Once' : frequency} />
        <ReviewItem label="Not included" value={`${held} people`} />
        <ReviewItem label="Send batches" value={batches.length} />
      </dl>
    </aside>
  );
}

function ReviewItem({ label, value }) {
  return (
    <div className="review-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
