// EmailProvider interface. Defines the contract every provider implementation
// must satisfy so Posty's send loop stays provider-agnostic. JS not TS, so we
// document the shape with JSDoc and have each provider expose the named
// methods directly. Anything not in this contract should be implementation
// detail of the specific provider.
//
// Add a new provider by:
//   1. Creating a new file in this directory exporting an object with these
//      methods.
//   2. Adding it to the switch in ./index.js -> selectProvider().
//   3. Documenting the env vars it expects in .env.example.
//
// The current default is Brevo. See BrevoProvider.js. The shape was extracted
// from the original brevoClient.js so all existing call sites work unchanged
// via the re-export shim in lib/brevoClient.js.

/**
 * @typedef {Object} EmailProvider
 *
 * @property {string} name
 *   Provider identifier ('brevo' | 'mailgun' | ...).
 *
 * @property {() => boolean} isConfigured
 *   Whether the provider has the credentials it needs to make real calls.
 *   Returning false flips every send into dry-run mode. Lets the app run
 *   without any credentials at all for local dev.
 *
 * @property {(params: {
 *   contact: Object,
 *   subject: string,
 *   htmlContent: string,
 *   textContent: string,
 *   sender: { email: string, name: string },
 *   idempotencyKey?: string,
 *   campaignId?: string,
 *   variantId?: string,
 * }) => Promise<Object>} sendTransactionalEmail
 *   Fire a single send. Return value is provider-specific but should include
 *   a `messageId` when available for the post-send write-back. In dry-run
 *   mode return `{ dryRun: true, ... }`.
 *
 * @property {(params: {
 *   toEmail: string,
 *   subject: string,
 *   htmlContent: string,
 *   textContent: string,
 *   sender: { email: string, name: string },
 * }) => Promise<Object>} sendTestEmail
 *   Fire a test send. Same shape as the main send minus the campaign tags.
 *
 * @property {(params?: {
 *   startDate?: string, endDate?: string, maxEvents?: number,
 * }) => Promise<Array<Object>>} fetchTransactionalEvents
 *   Pull stored engagement events for catch-up syncs on startup.
 *
 * @property {() => Promise<Array<{
 *   id?: string|number, email: string, name?: string, active: boolean,
 * }>>} fetchVerifiedSenders
 *   List the addresses the admin has verified at the provider. Drives the
 *   Settings dropdown. Empty array on providers that don't need verification.
 *
 * @property {(campaignId: string) => Promise<Object>} fetchMetrics
 *   Provider-side metrics for one campaign. Used as a fallback for the
 *   Reports page when local event data is incomplete. Return shape is
 *   provider-specific; safe to omit fields that don't apply.
 */

// No runtime export. This file is documentation that providers consume.
