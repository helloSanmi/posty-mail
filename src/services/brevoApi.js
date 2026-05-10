import { apiClient } from './apiClient';

// Lightweight, public-ish read used by the Settings page to confirm Brevo is
// actually configured on the backend. The endpoint is unauthenticated and
// returns `{ ok, databaseConnected, brevoConfigured }`.
export async function getHealth() {
  const { data } = await apiClient.get('/api/health');
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

export async function getCampaignRecipients(id) {
  const { data } = await apiClient.get(`/api/campaigns/${id}/recipients`);
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

export async function getEvents() {
  const { data } = await apiClient.get('/api/events');
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
