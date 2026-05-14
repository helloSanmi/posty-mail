// Provider selector. Reads EMAIL_PROVIDER from env and returns the matching
// provider object. Defaults to Brevo so existing installs keep working
// without any env change.
//
// To add a new provider:
//   1. Create ./<Name>Provider.js exporting an EmailProvider-shaped object
//      (see ./EmailProvider.js for the contract).
//   2. Import it here.
//   3. Add a case to the switch.
//   4. Document the required env vars in .env.example.
//
// Future providers: MailgunProvider, PostmarkProvider, SESProvider. Each one
// owns its own dry-run logic so the app-level send loop stays uniform.

import { BrevoProvider } from './BrevoProvider.js';

let cached = null;

function selectProvider() {
  const name = (process.env.EMAIL_PROVIDER || 'brevo').toLowerCase();
  switch (name) {
    case 'brevo':
      return BrevoProvider;
    // case 'mailgun':
    //   return MailgunProvider;
    // case 'postmark':
    //   return PostmarkProvider;
    // case 'ses':
    //   return SESProvider;
    default:
      console.warn(`[providers] unknown EMAIL_PROVIDER="${name}"; falling back to brevo.`);
      return BrevoProvider;
  }
}

/**
 * Returns the active EmailProvider. Cached for the lifetime of the process
 * because env vars don't change mid-run.
 * @returns {import('./EmailProvider.js').EmailProvider}
 */
export function getProvider() {
  if (!cached) cached = selectProvider();
  return cached;
}

// Test-only reset hook. Lets a future test swap EMAIL_PROVIDER mid-process
// and pick up the change. Not used in production.
export function _resetProviderCache() {
  cached = null;
}
