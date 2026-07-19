import { apiClient } from './apiClient';

// Lightweight, public-ish read used by the Settings page to confirm Brevo is
// actually configured on the backend. The endpoint is unauthenticated and
// returns `{ ok, databaseConnected, brevoConfigured, demoMode }`.
export async function getHealth() {
  const { data } = await apiClient.get('/api/health');
  return data;
}

// Aggregate "can this install send?" status: provider key validity, sender
// identity + verification, webhook. Admin/connections-gated.
export async function getSetupStatus() {
  const { data } = await apiClient.get('/api/settings/status');
  return data;
}

export async function getSenderSetting() {
  const { data } = await apiClient.get('/api/settings/sender');
  return data;
}

export async function saveSenderSetting({ email, name }) {
  const { data } = await apiClient.post('/api/settings/sender', { email, name });
  return data;
}

export async function getVerifiedSenders() {
  const { data } = await apiClient.get('/api/settings/sender/verified');
  return data;
}

// Resolves SPF / DKIM / DMARC for the configured sender domain. Returns
// { domain, spf, dkim, dmarc } where each record is
// { status: 'pass' | 'warn' | 'fail', message, hint?, found?, example? }.
// 400s with code 'SENDER_NOT_CONFIGURED' if the admin hasn't set a sender yet.
export async function getDeliverabilityCheck() {
  const { data } = await apiClient.get('/api/settings/sender/deliverability');
  return data;
}

export async function saveContactsLocally(contacts) {
  const { data } = await apiClient.post('/api/contacts/import', { contacts });
  return data;
}

export async function getSavedContacts(params) {
  const { data } = await apiClient.get('/api/contacts', { params });
  return data;
}

export async function bulkDeleteContacts(emails) {
  const { data } = await apiClient.post('/api/contacts/bulk-delete', { emails });
  return data;
}

// Patch a narrow set of fields (region, consent) across many contacts in
// one server call. Backed by /api/contacts/bulk-update (Prisma updateMany).
export async function bulkUpdateContacts(emails, patch) {
  const { data } = await apiClient.post('/api/contacts/bulk-update', { emails, patch });
  return data;
}

export function contactExportUrl(filter = {}) {
  const params = new URLSearchParams();
  Object.entries(filter).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== false) params.set(key, String(value));
  });
  const query = params.toString();
  return `/api/contacts/export${query ? `?${query}` : ''}`;
}

export async function downloadContactsCsv(filter = {}) {
  const response = await apiClient.get(contactExportUrl(filter), { responseType: 'blob' });
  const url = window.URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = `contacts-${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function getGroups() {
  const { data } = await apiClient.get('/api/audiences');
  return data;
}

export async function createGroup(payload) {
  const { data } = await apiClient.post('/api/audiences', payload);
  return data;
}

export async function deleteGroup(id) {
  const { data } = await apiClient.delete(`/api/audiences/${id}`);
  return data;
}

export async function setGroupDisabled(id, disabled) {
  const { data } = await apiClient.patch(`/api/audiences/${id}/disabled`, { disabled });
  return data;
}

export async function renameGroup(id, name) {
  const { data } = await apiClient.patch(`/api/audiences/${id}/name`, { name });
  return data;
}

export async function patchGroupMembers(id, { add, remove }) {
  const { data } = await apiClient.patch(`/api/audiences/${id}/members`, { add, remove });
  return data;
}

export async function getGroupContacts(id) {
  const { data } = await apiClient.get(`/api/audiences/${id}/contacts`);
  return data;
}

export async function getSegments() {
  const { data } = await apiClient.get('/api/segments');
  return data;
}

export async function saveSegment(segment) {
  const { data } = await apiClient.post('/api/segments', segment);
  return data;
}

export async function deleteSegment(id) {
  const { data } = await apiClient.delete(`/api/segments/${id}`);
  return data;
}

export async function getSegmentContacts(id) {
  const { data } = await apiClient.get(`/api/segments/${id}/contacts`);
  return data;
}


// Read-only preview of an unsaved filter. Used by the composer to show a live
// "would match N contacts" count and a 25-row sample while the admin builds
// the rules. Powered by POST so the filter rides in the body.
export async function previewSegmentFilter(filter) {
  const { data } = await apiClient.post('/api/segments/preview', { filter });
  return data;
}

// Cached preview of a saved segment (count + sample). The Segments page uses
// this for the list view so each row shows "matches N contacts" without
// re-fetching the full contact list.
export async function getSegmentPreview(id) {
  const { data } = await apiClient.get(`/api/segments/${id}/preview`);
  return data;
}

export async function cloneCampaign(id) {
  const { data } = await apiClient.post(`/api/campaigns/${id}/clone`);
  return data;
}

export async function deleteCampaign(id) {
  const { data } = await apiClient.delete(`/api/campaigns/${id}`);
  return data;
}

export async function updateCampaign(id, payload) {
  const { data } = await apiClient.patch(`/api/campaigns/${id}`, payload);
  return data;
}

export async function deleteDraft(id) {
  const { data } = await apiClient.delete(`/api/campaigns/drafts/${id}`);
  return data;
}

export async function getCampaignRecipients(id, { page = 1, pageSize = 50 } = {}) {
  const { data } = await apiClient.get(`/api/campaigns/${id}/recipients`, {
    params: { page, pageSize },
  });
  // Returns { rows, total, page, pageSize, totalPages } since pagination
  // was added — the old plain-array shape is no longer emitted.
  return data;
}

export async function getCampaignLinks(id) {
  const { data } = await apiClient.get(`/api/campaigns/${id}/links`);
  return data;
}

export async function getCampaignVariants(id) {
  const { data } = await apiClient.get(`/api/campaigns/${id}/variants`);
  return data;
}

export async function getBounceSync() {
  const { data } = await apiClient.get('/api/integrations/bounce-sync');
  return data;
}

export async function setBounceSync(enabled) {
  const { data } = await apiClient.put('/api/integrations/bounce-sync', { enabled });
  return data;
}

export async function listAdminUsers() {
  const { data } = await apiClient.get('/api/admin/users');
  return data;
}

export async function createAdminUser(payload) {
  const { data } = await apiClient.post('/api/admin/users', payload);
  return data;
}

export async function updateAdminUser(id, payload) {
  const { data } = await apiClient.patch(`/api/admin/users/${id}`, payload);
  return data;
}

export async function resetUserPassword(id, password) {
  const { data } = await apiClient.post(`/api/admin/users/${id}/password`, { password });
  return data;
}

export async function deleteAdminUser(id) {
  const { data } = await apiClient.delete(`/api/admin/users/${id}`);
  return data;
}

// Roles (admin-only). Each role carries a `permissions` array of area keys.
export async function listRoles() {
  const { data } = await apiClient.get('/api/roles');
  return data;
}

export async function createRole(payload) {
  const { data } = await apiClient.post('/api/roles', payload);
  return data;
}

export async function updateRole(id, payload) {
  const { data } = await apiClient.patch(`/api/roles/${id}`, payload);
  return data;
}

export async function deleteRole(id) {
  const { data } = await apiClient.delete(`/api/roles/${id}`);
  return data;
}

// Super-admin (install-level, cross-workspace) endpoints.
export async function listWorkspaces() {
  const { data } = await apiClient.get('/api/super-admin/accounts');
  return data;
}

export async function deleteWorkspace(id) {
  const { data } = await apiClient.delete(`/api/super-admin/accounts/${id}`);
  return data;
}

export async function getAuditLogs(params = {}) {
  const { data } = await apiClient.get('/api/admin/audit', { params });
  return data;
}

export async function updateContact(email, contact) {
  const { data } = await apiClient.put(`/api/contacts/${encodeURIComponent(email)}`, contact);
  return data;
}

export async function deleteContact(email) {
  const { data } = await apiClient.delete(`/api/contacts/${encodeURIComponent(email)}`);
  return data;
}

export async function scheduleCampaign(payload) {
  const { data } = await apiClient.post('/api/campaigns/schedule', payload);
  return data;
}

export async function getCampaigns(params) {
  // Without params: returns a flat array (dashboard / KPI counts).
  // With { page, pageSize }: returns { rows, total, page, pageSize, totalPages }.
  const { data } = await apiClient.get('/api/campaigns', { params });
  return data;
}

export async function getCampaignMetrics(campaignId) {
  const { data } = await apiClient.get(`/api/campaigns/${campaignId}/metrics`);
  return data;
}

export async function getDrafts() {
  const { data } = await apiClient.get('/api/campaigns/drafts');
  return data;
}

export async function saveDraft(payload) {
  const { data } = await apiClient.post('/api/campaigns/drafts', payload);
  return data;
}

export async function sendTestCampaignEmail(payload) {
  const { data } = await apiClient.post('/api/campaigns/test-email', payload);
  return data;
}

// Returns { ok, checks } where each check is
// { code, severity: 'error' | 'warn' | 'info', message, hint?, meta? }.
// Called from the Builder before scheduling to surface a checklist so the
// admin can fix issues (missing unsubscribe, all-caps subject, oversized HTML,
// broken merge tags, unreachable images, etc.) before the campaign goes out.
export async function preflightCampaign({ template }) {
  const { data } = await apiClient.post('/api/campaigns/preflight', { template });
  return data;
}

// Coarse send-readiness (provider key working? sender configured + verified?)
// for the Builder's pre-send panel. Safe for editors — no sensitive config.
export async function getSendReadiness() {
  const { data } = await apiClient.get('/api/campaigns/send-readiness');
  return data;
}

export async function saveWebhookIntegration(payload) {
  const { data } = await apiClient.post('/api/integrations/webhook', payload);
  return data;
}

export async function uploadLogoAsset({ fileName, dataUrl }) {
  const { data } = await apiClient.post('/api/assets/logo', { fileName, dataUrl });
  return data;
}

export async function listLogoAssets() {
  const { data } = await apiClient.get('/api/assets/logos');
  return data;
}

export async function deleteLogoAsset(id) {
  const { data } = await apiClient.delete(`/api/assets/${id}`);
  return data;
}

export async function getSavedTemplates() {
  const { data } = await apiClient.get('/api/templates');
  return data;
}

export async function saveTemplate(template) {
  const { data } = await apiClient.post('/api/templates', template);
  return data;
}

export async function deleteTemplate(templateId) {
  const { data } = await apiClient.delete(`/api/templates/${encodeURIComponent(templateId)}`);
  return data;
}

export async function getHiddenBuiltinTemplates() {
  const { data } = await apiClient.get('/api/templates/hidden-builtins');
  return data;
}

export async function restoreBuiltinTemplate(templateId) {
  const { data } = await apiClient.delete(`/api/templates/hidden-builtins/${encodeURIComponent(templateId)}`);
  return data;
}

export async function getUnsubscribes() {
  const { data } = await apiClient.get('/api/unsubscribes');
  return data;
}

export async function addUnsubscribe(payload) {
  const { data } = await apiClient.post('/api/unsubscribe', payload);
  return data;
}

export async function restoreUnsubscribe(email) {
  const { data } = await apiClient.delete(`/api/unsubscribes/${encodeURIComponent(email)}`);
  return data;
}

// Preference-center categories. Read/write the admin-defined list that
// powers the per-topic checkboxes on the public /unsubscribe page. Returns
// `{ categories: [{ id, label, description? }, ...] }`. Empty list means
// the unsubscribe page stays in legacy all-or-nothing mode.
export async function getUnsubscribeCategories() {
  const { data } = await apiClient.get('/api/settings/unsubscribe-categories');
  return data?.categories || [];
}

export async function saveUnsubscribeCategories(categories) {
  const { data } = await apiClient.put('/api/settings/unsubscribe-categories', { categories });
  return data?.categories || [];
}

// Optional date-range filtering. Pass `{ since, until }` as Date objects;
// they're serialized to ISO strings on the query string. Server returns the
// latest 500 events with no filter, up to 5000 when filtered (so a 30-day
// window doesn't silently truncate on a high-volume install).
export async function getEvents({ since, until } = {}) {
  const params = {};
  if (since instanceof Date) params.since = since.toISOString();
  if (until instanceof Date) params.until = until.toISOString();
  const { data } = await apiClient.get('/api/events', { params });
  return data;
}

export async function getNotifications() {
  const { data } = await apiClient.get('/api/notifications');
  return data;
}

export async function markNotificationsRead() {
  const { data } = await apiClient.post('/api/notifications/read');
  return data;
}

export async function clearNotifications() {
  const { data } = await apiClient.post('/api/notifications/clear');
  return data;
}
