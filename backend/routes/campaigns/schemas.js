// Shared Zod schemas + small helpers used across the campaigns routes.
import { z } from '../../lib/validate.js';

export const templateSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().min(1),
  logoUrl: z.string().optional(),
}).passthrough();

export const contactSchema = z.object({
  email: z.string().email(),
}).passthrough();

export const variantSchema = z.object({
  id: z.string().optional(),
  label: z.string().max(80).optional(),
  subject: z.string().min(1).max(998).optional(),
  html: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  weight: z.number().min(1).max(100).optional(),
});

export const scheduleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  contacts: z.array(contactSchema).min(1, 'At least one contact is required'),
  template: templateSchema,
  variants: z.array(variantSchema).max(4).optional(),
  batchSize: z.number().int().min(1).max(1000).optional(),
  delayMinutes: z.number().min(0).max(60).optional(),
  // Accepts BOTH full ISO instants ("...Z" / offset) and local-naive
  // datetime strings ("2026-05-13T09:00"). The latter is used for
  // send-time-per-timezone mode where the digits are the per-recipient
  // wall-clock target.
  scheduledAt: z.string()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
      'Invalid datetime',
    )
    .optional(),
  schedule: z.object({
    frequency: z.enum(['once', 'daily', 'weekly', 'monthly']).optional(),
    timezone: z.string().optional(),
  }).optional(),
  compliance: z.object({
    requireOptIn: z.boolean().optional(),
    gdprMode: z.boolean().optional(),
  }).optional(),
  unsubscribeBaseUrl: z.string().url().optional(),
  useRecipientTimezone: z.boolean().optional(),
});

export const draftSchema = z.object({
  id: z.string().optional(),
  name: z.string().max(200).optional(),
}).passthrough();

export const testEmailSchema = z.object({
  toEmail: z.string().email(),
  template: templateSchema,
  contact: z.record(z.unknown()).optional(),
});

// Strip large fields from a campaign before returning it through the JSON
// API. The full contact list + template body live inside `data` JSON and
// belong on the per-campaign endpoints, not in the list view.
export function serializeCampaign(campaign) {
  return {
    ...campaign,
    contacts: undefined,
    template: undefined,
    batches: undefined,
  };
}

// Tiny merge for previews + test sends. Renders only the two tags the test
// endpoint needs (firstname + unsubscribeUrl). Real campaign sends go
// through the scheduler's full renderTemplate.
export function merge(template, contact) {
  return template
    .replace(/\{\{\s*firstname\s*\}\}/g, contact.firstname || '')
    .replace(/\{\{\s*unsubscribeUrl\s*\}\}/g, contact.unsubscribeUrl);
}
