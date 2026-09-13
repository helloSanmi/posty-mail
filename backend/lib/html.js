// HTML escaping for server-rendered markup and outbound email bodies.
//
// Lives in lib/ rather than beside its first caller because lib/ must never
// import from routes/ — backend/lib/passwordReset.js builds an email body from
// operator-supplied text (an Account name), and reaching into
// routes/integrations/unsubscribe-page.js for it would invert the dependency.
// The old location re-exports this, so there is one implementation and no
// second copy to drift.
export function escapeHtml(value) {
  return String(value).replace(/[<>"&]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' }[c]
  ));
}
