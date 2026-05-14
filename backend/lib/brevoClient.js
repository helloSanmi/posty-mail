// Thin shim around the active EmailProvider. The original implementation
// (the Brevo HTTP client + helpers) now lives in ./providers/BrevoProvider.js.
//
// We keep this file as the public surface so call sites
// (scheduler.js, routes/campaigns.js, syncBrevoEvents.js, etc.) keep working
// without import-path churn. To switch providers, set EMAIL_PROVIDER in env
// and add the new provider to lib/providers/. No changes needed here.

import { getProvider } from './providers/index.js';

export function sendTransactionalEmail(args) {
  return getProvider().sendTransactionalEmail(args);
}

export function sendTestEmail(args) {
  return getProvider().sendTestEmail(args);
}

export function fetchTransactionalEvents(args) {
  return getProvider().fetchTransactionalEvents(args);
}

export function fetchVerifiedSenders() {
  return getProvider().fetchVerifiedSenders();
}

export function fetchMetrics(campaignId) {
  return getProvider().fetchMetrics(campaignId);
}
