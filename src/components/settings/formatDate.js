// Used by every Settings card that prints a "saved on" / "unsubscribed on"
// timestamp. Falls through to the raw value on bad input rather than
// throwing, so a malformed DB row doesn't blow up the whole card.
export function formatDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(value));
  } catch {
    return value;
  }
}
