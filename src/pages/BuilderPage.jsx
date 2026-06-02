import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, Send } from 'lucide-react';
import { AdvancedSendSettings } from '../components/AdvancedSendSettings';
import { CampaignForm } from '../components/CampaignForm';
import { CampaignTabs } from '../components/CampaignTabs';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { InboxPreviewModal } from '../components/InboxPreviewModal';
import { SendReview } from '../components/SendReview';
import { VariantsEditor } from '../components/VariantsEditor';
import { defaultTemplates } from '../templates/defaultTemplates';
import { chunkContacts, complianceIssues } from '../../shared/campaignUtils.js';
import {
  deleteDraft,
  getGroupContacts,
  getGroups,
  getHiddenBuiltinTemplates,
  getSavedTemplates,
  getSegmentContacts,
  getSegments,
  preflightCampaign,
  saveDraft,
  scheduleCampaign,
  sendTestCampaignEmail,
} from '../services/brevoApi';

const AUTOSAVE_DEBOUNCE_MS = 800;
const PREFLIGHT_DEBOUNCE_MS = 600;

export function BuilderPage(props) {
  const { contacts: allContacts, template, setTemplate, setPage, notify, onCampaignScheduled, refreshContacts } = props;
  const location = useLocation();
  const navigate = useNavigate();
  // /builder is always a NEW campaign unless the user explicitly clicked
  // "Resume" on a saved draft (which navigates with state.draft attached).
  // We deliberately don't auto-resume a previous draft from localStorage.
  // that locked the builder into editing one perpetual draft and prevented
  // the user from creating multiple drafts. To continue an in-progress
  // campaign, head to All campaigns → Drafts → Resume.
  const draftFromNav = location.state?.draft;

  // Active draft id. `null` means "no draft created yet for this session";
  // the first autosave will create one and store its id here.
  const draftIdRef = useRef(draftFromNav?.id || null);
  // Snapshot of the last successfully-saved state, so unchanged renders are skipped.
  const lastSavedSnapshotRef = useRef('');
  // Pending debounce timer. Cleared on unmount or when a newer change arrives.
  const autosaveTimerRef = useRef(null);
  // Template id we want to apply once savedTemplates finishes loading.
  // Set on mount when resuming a draft so the parent's template state matches
  // what was saved (the parent's `template` prop comes from app-level state
  // and isn't aware of which draft we're editing).
  const pendingTemplateIdRef = useRef(draftFromNav?.templateId || null);

  const [form, setForm] = useState(() => ({
    ...initialForm,
    ...(draftFromNav?.form || {}),
  }));
  const [status, setStatus] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(Boolean(draftFromNav?.showAdvanced));
  const [testEmail, setTestEmail] = useState(draftFromNav?.testEmail || '');
  const [savedTemplates, setSavedTemplates] = useState([]);
  const [hiddenBuiltins, setHiddenBuiltins] = useState(new Set());
  const [groups, setGroups] = useState([]);
  // Recipients can be the union of zero or more groups. Empty array means
  // "all contacts" (the parent's full list); one or more means we union the
  // members of each selected group, deduped by email.
  const [selectedGroupIds, setSelectedGroupIds] = useState(() => {
    if (Array.isArray(draftFromNav?.groupIds)) return draftFromNav.groupIds;
    if (draftFromNav?.groupId) return [draftFromNav.groupId];
    return [];
  });
  const [segments, setSegments] = useState([]);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState(() => {
    return Array.isArray(draftFromNav?.segmentIds) ? draftFromNav.segmentIds : [];
  });
  // Two acknowledgement flags. The admin must explicitly pick a template AND
  // a recipient option before sending. No silent defaults. A draft restore
  // counts as already-acknowledged: we honor an explicit flag if the saved
  // payload has one, otherwise we infer from whether a value was saved.
  const [templateChosen, setTemplateChosen] = useState(() => {
    if (draftFromNav?.templateChosen != null) return Boolean(draftFromNav.templateChosen);
    return Boolean(draftFromNav?.templateId);
  });
  const [recipientsChosen, setRecipientsChosen] = useState(() => {
    if (draftFromNav?.recipientsChosen != null) return Boolean(draftFromNav.recipientsChosen);
    return Array.isArray(draftFromNav?.groupIds)
      || Boolean(draftFromNav?.groupId)
      || (Array.isArray(draftFromNav?.segmentIds) && draftFromNav.segmentIds.length > 0);
  });
  const [groupContacts, setGroupContacts] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [variants, setVariants] = useState(draftFromNav?.variants || []);
  const [confirm, setConfirm] = useState(null);
  // 'idle' | 'saving' | 'saved' | 'error'
  const [saveState, setSaveState] = useState('idle');
  // Pre-send lint result. Refreshed (debounced) whenever the template
  // changes; cleared while a new fetch is in flight.
  const [preflight, setPreflight] = useState(null);
  const preflightTimerRef = useRef(null);
  // Inbox-preview modal open/closed.
  const [previewOpen, setPreviewOpen] = useState(false);

  const contacts = groupContacts ?? allContacts;
  const batches = useMemo(() => chunkContacts(contacts, form.batchSize), [contacts, form.batchSize]);
  // Held contacts carry their compliance reason(s) so the Review panel can
  // explain WHY each one is excluded, not just count them. readyList is the
  // complement — everyone who'll actually receive the send.
  const heldList = useMemo(() => getHeldContacts(contacts, form), [contacts, form]);
  const readyList = useMemo(() => {
    const heldEmails = new Set(heldList.map((entry) => entry.contact.email));
    return contacts.filter((contact) => !heldEmails.has(contact.email));
  }, [contacts, heldList]);
  const held = heldList.length;
  const readyContacts = readyList.length;
  const canSchedule = readyContacts > 0;
  const preflightErrors = (preflight?.checks || []).filter((c) => c.severity === 'error');
  const hasPreflightErrors = preflightErrors.length > 0;
  // Send button is only enabled once every required field has been touched
  // AND the pre-send checklist has no error-severity rows. We keep validation
  // in requestSchedule() too so the click surfaces a clear error message,
  // but greying the button out is the first hint.
  const readyToSchedule = canSchedule
    && Boolean(form.name.trim())
    && templateChosen
    && recipientsChosen
    && !hasPreflightErrors;
  // Built-ins the admin has deleted are kept out of the picker here too,
  // not just on the Templates page. (Hidden-builtins list is server-truth
  // via /api/templates/hidden-builtins, so deletes sync across pages and
  // devices.)
  const visibleDefaults = defaultTemplates.filter((t) => !hiddenBuiltins.has(t.id));
  const templateOptions = [...visibleDefaults, ...savedTemplates];
  // Empty string until the admin actively picks a template, so the <select>
  // displays the "Select template..." placeholder rather than silently
  // defaulting to whatever happens to be first in the list.
  const selectedTemplateId = templateChosen ? (template.id || templateOptions[0]?.id || '') : '';

  useEffect(() => {
    getSavedTemplates().then(setSavedTemplates).catch(() => setSavedTemplates([]));
    getHiddenBuiltinTemplates()
      .then((ids) => setHiddenBuiltins(new Set(Array.isArray(ids) ? ids : [])))
      .catch(() => setHiddenBuiltins(new Set()));
    getGroups().then(setGroups).catch(() => setGroups([]));
    getSegments().then(setSegments).catch(() => setSegments([]));
    // Force the parent's contacts state to refresh. Its initial fetch happened
    // at app boot, so a contact added on the Audience page since then would not
    // be reflected in the audience count here.
    refreshContacts?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced preflight. Pings /api/campaigns/preflight whenever the template
  // or subject changes and stores the structured checklist. Used to (a) render
  // the "Pre-send checks" panel and (b) block Send when any error-severity
  // check is open. We never throw on failure. preflight is best-effort lint,
  // not a transactional check.
  useEffect(() => {
    if (!template?.subject && !template?.html) {
      setPreflight(null);
      return undefined;
    }
    if (preflightTimerRef.current) clearTimeout(preflightTimerRef.current);
    let cancelled = false;
    preflightTimerRef.current = setTimeout(async () => {
      try {
        const result = await preflightCampaign({
          template: {
            subject: template.subject || '',
            html: template.html || '',
            text: template.text || '',
            logoUrl: template.logoUrl || '',
          },
        });
        if (!cancelled) setPreflight(result);
      } catch {
        // Surface nothing in the UI. Preflight is non-blocking on network errors.
        if (!cancelled) setPreflight(null);
      }
    }, PREFLIGHT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      if (preflightTimerRef.current) clearTimeout(preflightTimerRef.current);
    };
  }, [template?.subject, template?.html, template?.text, template?.logoUrl]);

  // Once savedTemplates loads, apply any deferred templateId from a restore.
  useEffect(() => {
    const pending = pendingTemplateIdRef.current;
    if (!pending) return;
    const all = [...defaultTemplates, ...savedTemplates];
    const match = all.find((item) => item.id === pending);
    if (match) {
      setTemplate(match);
      pendingTemplateIdRef.current = null;
    }
  }, [savedTemplates, setTemplate]);

  useEffect(() => {
    // Recipients are the union of (selected groups) ∪ (selected segments).
    // No selection at all → null (fall through to all contacts).
    if (!selectedGroupIds.length && !selectedSegmentIds.length) {
      setGroupContacts(null);
      return;
    }
    let cancelled = false;
    setGroupContacts(null); // show "Counting…" while we fetch
    const groupFetches = selectedGroupIds.map((id) => getGroupContacts(id).catch(() => []));
    const segmentFetches = selectedSegmentIds.map((id) => getSegmentContacts(id).catch(() => []));
    Promise.all([...groupFetches, ...segmentFetches])
      .then((lists) => {
        if (cancelled) return;
        // Union by email so a contact in two selected groups (or a group AND
        // a segment that matches them) isn't double-counted.
        const seen = new Set();
        const merged = [];
        for (const list of lists) {
          for (const contact of list) {
            const email = contact?.email;
            if (!email || seen.has(email)) continue;
            seen.add(email);
            merged.push(contact);
          }
        }
        setGroupContacts(merged);
      })
      .catch(() => {
        if (!cancelled) {
          notify('Could not load recipient contacts', 'error');
          setSelectedGroupIds([]);
          setSelectedSegmentIds([]);
        }
      });
    return () => { cancelled = true; };
  }, [selectedGroupIds, selectedSegmentIds, notify]);

  // Debounced autosave to the Draft table. On a fresh /builder visit there is
  // no draft id yet. The first autosave creates one. On a Resume click the
  // draft id is already set from `state.draft` and subsequent saves upsert
  // that same row. Since /builder no longer auto-resumes via localStorage,
  // every fresh visit creates a NEW draft, which is exactly how the user
  // accumulates multiple drafts in the Drafts list.
  useEffect(() => {
    const snapshot = JSON.stringify({
      form, selectedGroupIds, selectedSegmentIds, variants, testEmail, showAdvanced,
      templateId: template.id, templateChosen, recipientsChosen,
    });
    if (snapshot === lastSavedSnapshotRef.current) return undefined;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        setSaveState('saving');
        const saved = await saveDraft({
          id: draftIdRef.current || undefined,
          name: form.name || 'Untitled campaign',
          form,
          templateId: template.id,
          groupIds: selectedGroupIds,
          segmentIds: selectedSegmentIds,
          variants,
          testEmail,
          showAdvanced,
          templateChosen,
          recipientsChosen,
        });
        lastSavedSnapshotRef.current = snapshot;
        if (!draftIdRef.current) draftIdRef.current = saved.id;
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [
    form, selectedGroupIds, selectedSegmentIds, variants, testEmail,
    showAdvanced, template.id, templateChosen, recipientsChosen,
  ]);

  function requestSchedule() {
    if (!form.name.trim()) {
      setStatus('Give your campaign a name first.');
      notify('Give your campaign a name first.', 'error');
      return;
    }
    if (!templateChosen) {
      setStatus('Pick an email template.');
      notify('Pick an email template.', 'error');
      return;
    }
    if (!recipientsChosen) {
      setStatus('Pick who this goes to.');
      notify('Pick who this goes to.', 'error');
      return;
    }
    if (hasPreflightErrors) {
      const first = preflightErrors[0];
      setStatus(first.message);
      notify(`Fix the pre-send checks before sending. ${first.message}`, 'error');
      return;
    }
    if (!contacts.length) {
      setStatus('Add an audience before scheduling a campaign.');
      return;
    }
    if (form.sendMode === 'schedule' && !form.scheduledAt) {
      setStatus('Pick a send date and time.');
      return;
    }

    const isNow = form.sendMode === 'now';
    const peopleCount = readyContacts;
    const whenLabel = isNow ? 'right now' : formatScheduledAt(form.scheduledAt);

    setConfirm({
      title: isNow ? `Send to ${peopleCount} people now?` : `Schedule send to ${peopleCount} people?`,
      message: isNow
        ? 'Emails will start going out immediately. This cannot be undone.'
        : `Emails will be sent ${whenLabel}.`,
      confirmLabel: isNow ? 'Send now' : 'Schedule send',
      confirmVariant: 'primary',
      onConfirm: doSchedule,
    });
  }

  async function doSchedule() {
    setSubmitting(true);
    try {
      // Cancel any pending autosave so we don't accidentally re-create the draft
      // we're about to delete.
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

      setStatus('Scheduling campaign...');
      await scheduleCampaign(buildCampaignPayload(form, contacts, template, variants));
      notify(
        form.sendMode === 'now'
          ? 'Campaign sending. Track progress in Campaigns'
          : 'Campaign scheduled. Track in Campaigns',
      );
      onCampaignScheduled();

      // The draft has now been promoted to a real campaign; delete the draft
      // row so it doesn't linger in the Drafts list.
      const id = draftIdRef.current;
      if (id) {
        try { await deleteDraft(id); } catch { /* non-fatal */ }
        draftIdRef.current = null;
      }

      // Reset transient UI.
      setStatus('');
      setTestEmail('');
      setVariants([]);
      navigate('/campaigns');
    } catch (error) {
      const message = error.response?.data?.error || 'Scheduling failed';
      setStatus(message);
      notify(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function requestTestEmail() {
    if (!testEmail) {
      setStatus('Enter a test email address.');
      notify('Enter a test email address', 'error');
      return;
    }
    setConfirm({
      title: 'Send test email?',
      message: `A real email will be sent to ${testEmail} using the current template.`,
      confirmLabel: 'Send test',
      confirmVariant: 'primary',
      onConfirm: doSendTest,
    });
  }

  async function doSendTest() {
    try {
      const result = await sendTestCampaignEmail({
        toEmail: testEmail,
        template,
        contact: contacts[0],
      });
      const message = result.dryRun ? 'Test email dry-run complete' : `Test email sent to ${testEmail}`;
      setStatus(`${message}.`);
      notify(message);

      // The recipient's mail client can't fetch localhost / private-network URLs,
      // so embedded images render as broken icons. Surface the offending URLs
      // loud and clear instead of letting the user wonder why the logo is broken.
      const unreachable = (result.warnings || []).find((w) => w.kind === 'unreachable_images');
      if (unreachable) {
        notify(
          `Heads up: ${unreachable.urls.length} image URL${unreachable.urls.length === 1 ? '' : 's'} won't load in mail (localhost / private network). Set PUBLIC_BASE_URL on the backend.`,
          'error',
        );
      }
    } catch (error) {
      const message = error.response?.data?.error || 'Test send failed';
      setStatus(message);
      notify(message, 'error');
    }
  }

  // Manual flush of the autosave. Useful when the user clicks "Save draft"
  // and wants explicit confirmation rather than waiting for the debounce.
  async function handleSaveDraft() {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    try {
      setSaveState('saving');
      const saved = await saveDraft({
        id: draftIdRef.current || undefined,
        name: form.name || 'Untitled campaign',
        form,
        templateId: template.id,
        groupIds: selectedGroupIds,
        segmentIds: selectedSegmentIds,
        variants,
        testEmail,
        showAdvanced,
        templateChosen,
        recipientsChosen,
      });
      if (!draftIdRef.current) draftIdRef.current = saved.id;
      lastSavedSnapshotRef.current = JSON.stringify({
        form, selectedGroupIds, selectedSegmentIds, variants, testEmail, showAdvanced,
        templateId: template.id, templateChosen, recipientsChosen,
      });
      setSaveState('saved');
      notify('Draft saved');
    } catch (error) {
      setSaveState('error');
      notify(error.response?.data?.error || 'Could not save draft', 'error');
    }
  }

  function selectTemplate(event) {
    const selected = templateOptions.find((item) => item.id === event.target.value);
    if (selected) {
      setTemplate(selected);
      setTemplateChosen(true);
    }
  }

  // Wraps setSelectedGroupIds so the first time the admin touches the
  // recipients picker (whether they pick groups or "All contacts") we flip
  // recipientsChosen and unblock the send button.
  function handleSelectGroups(ids) {
    setSelectedGroupIds(Array.isArray(ids) ? ids : []);
    setRecipientsChosen(true);
  }

  // Same idea for segments. Either picker counts as "the admin chose."
  function handleSelectSegments(ids) {
    setSelectedSegmentIds(Array.isArray(ids) ? ids : []);
    setRecipientsChosen(true);
  }

  return (
    <div className="page-stack content-page">
      <CampaignTabs active="new" />
      <section className="send-page-grid">
        <div className="surface send-main">
          <div className="section-heading">
            <h2>Create campaign</h2>
            <SaveIndicator state={saveState} />
          </div>
          {!canSchedule && <AudienceBlocker setPage={setPage} />}
          <CampaignForm
            form={form}
            setForm={setForm}
            templateOptions={templateOptions}
            selectedTemplateId={selectedTemplateId}
            onSelectTemplate={selectTemplate}
            templateChosen={templateChosen}
            groups={groups.filter((g) => !g.disabled)}
            selectedGroupIds={selectedGroupIds}
            onSelectGroups={handleSelectGroups}
            segments={segments}
            selectedSegmentIds={selectedSegmentIds}
            onSelectSegments={handleSelectSegments}
            recipientsChosen={recipientsChosen}
            recipientCount={readyContacts}
            recipientLoading={(selectedGroupIds.length > 0 || selectedSegmentIds.length > 0) && groupContacts === null}
          />
          <div className="test-email-row">
            <label className="test-email-label">
              Send a test
              <input
                type="email"
                value={testEmail}
                onChange={(event) => setTestEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              disabled={!template?.html}
              title={template?.html ? 'See how it renders in Gmail, Outlook, and Apple Mail' : 'Pick a template first'}
            >
              <Eye size={14} aria-hidden="true" /> Inbox preview
            </button>
            <button type="button" onClick={requestTestEmail}>Send test</button>
          </div>
          <VariantsEditor
            variants={variants}
            onChange={setVariants}
            baseTemplate={template}
          />
          {showAdvanced && <AdvancedSendSettings form={form} setForm={setForm} />}
          <PreflightPanel result={preflight} />
          <div className="send-secondary-actions">
            <button
              className="text-button"
              type="button"
              onClick={() => setShowAdvanced((value) => !value)}
            >
              {showAdvanced ? 'Hide advanced settings' : 'Show advanced settings'}
            </button>
          </div>
          <div className="actions-row send-actions">
            <button type="button" onClick={handleSaveDraft}>Save draft</button>
            <button
              className="primary"
              type="button"
              onClick={requestSchedule}
              disabled={!readyToSchedule || submitting}
            >
              <Send size={18} aria-hidden="true" />
              {submitting ? 'Scheduling…' : (canSchedule ? (form.sendMode === 'now' ? 'Send now' : 'Schedule send') : 'Add audience first')}
            </button>
            {status && <span className="inline-status" role="status">{status}</span>}
          </div>
        </div>
        <SendReview
          readyContacts={readyContacts}
          readyList={readyList}
          template={template}
          frequency={form.frequency}
          held={held}
          heldList={heldList}
          batches={batches}
        />
      </section>

      {confirm && (
        <ConfirmDialog
          {...confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await confirm.onConfirm();
            setConfirm(null);
          }}
        />
      )}

      {previewOpen && (
        <InboxPreviewModal
          template={template}
          sampleContact={contacts[0]}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

// Pre-send checks UI. Compact when everything passes, expandable to the full
// list. Errors block send (gated upstream via readyToSchedule); warnings and
// info are advisory.
function PreflightPanel({ result }) {
  // `result` is null while a fetch is in flight or before the first one.
  // Don't show a "no checks yet" panel. Just nothing. Renders the checklist
  // once we have one.
  if (!result || !Array.isArray(result.checks)) return null;
  const groups = {
    error: result.checks.filter((c) => c.severity === 'error'),
    warn: result.checks.filter((c) => c.severity === 'warn'),
    info: result.checks.filter((c) => c.severity === 'info'),
  };
  const total = groups.error.length + groups.warn.length + groups.info.length;
  if (total === 0) {
    return (
      <div className="preflight-panel is-ok" role="status">
        <strong>✓ Pre-send checks passed.</strong>
        <span className="muted">Subject, unsubscribe, size, links, images all look good.</span>
      </div>
    );
  }
  // Headline summary string. e.g. "2 errors, 1 warning, 1 note"
  const parts = [];
  if (groups.error.length) parts.push(`${groups.error.length} ${groups.error.length === 1 ? 'error' : 'errors'}`);
  if (groups.warn.length) parts.push(`${groups.warn.length} ${groups.warn.length === 1 ? 'warning' : 'warnings'}`);
  if (groups.info.length) parts.push(`${groups.info.length} ${groups.info.length === 1 ? 'note' : 'notes'}`);
  const severityClass = groups.error.length
    ? 'is-error'
    : groups.warn.length
      ? 'is-warn'
      : 'is-info';
  return (
    <details className={`preflight-panel ${severityClass}`}>
      <summary>
        <strong>Pre-send checks</strong>
        <span className="muted">{parts.join(', ')}</span>
      </summary>
      <ul className="preflight-list">
        {[...groups.error, ...groups.warn, ...groups.info].map((check) => (
          <li key={check.code} className={`preflight-row is-${check.severity}`}>
            <span className="preflight-tag">{check.severity}</span>
            <div>
              <div className="preflight-message">{check.message}</div>
              {check.hint && <div className="preflight-hint muted">{check.hint}</div>}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function SaveIndicator({ state }) {
  if (state === 'saving') return <span className="muted save-indicator">Saving…</span>;
  if (state === 'saved') return <span className="muted save-indicator">Saved</span>;
  if (state === 'error') return <span className="save-indicator save-indicator-error">Save failed. Will retry on next change</span>;
  return null;
}

function formatScheduledAt(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return 'at the scheduled time';
  }
}

function AudienceBlocker({ setPage }) {
  return (
    <div className="blocker-banner">
      <div>
        <strong>Add an audience first</strong>
        <span>You need saved people before you can schedule a send.</span>
      </div>
      <button onClick={() => setPage('contacts')}>Go to Audience</button>
    </div>
  );
}

// Returns [{ contact, reasons }] for every contact that fails a compliance
// check, so the Review panel can both count them AND show why each is held.
function getHeldContacts(contacts, form) {
  return contacts.reduce((held, contact) => {
    const reasons = complianceIssues(contact, {
      requireOptIn: form.requireOptIn,
      gdprMode: form.gdprMode,
    });
    if (reasons.length > 0) held.push({ contact, reasons });
    return held;
  }, []);
}

function buildCampaignPayload(form, contacts, template, variants) {
  // Per-timezone mode treats the typed time as a local wall-clock target,
  // not a UTC instant — preserve the original string so the scheduler can
  // parse the components without timezone interpretation.
  const scheduledAt = form.sendMode === 'now'
    ? new Date().toISOString()
    : (form.useRecipientTimezone ? form.scheduledAt : new Date(form.scheduledAt).toISOString());

  return {
    name: form.name,
    contacts,
    template,
    variants: variants && variants.length ? variants : undefined,
    batchSize: Number(form.batchSize) || 300,
    delayMinutes: Number(form.delayMinutes) || 0,
    scheduledAt,
    schedule: {
      frequency: form.sendMode === 'now' ? 'once' : form.frequency,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    compliance: {
      requireOptIn: form.requireOptIn,
      gdprMode: form.gdprMode,
    },
    // Only meaningful when sendMode === 'schedule'. Ignored for 'now'.
    useRecipientTimezone: form.sendMode === 'schedule' && Boolean(form.useRecipientTimezone),
  };
}

const initialForm = {
  // Name starts empty; the admin types one. Used to default to "New campaign"
  // which felt presumptuous (and ended up as the saved name when people
  // forgot to change it).
  name: '',
  batchSize: 300,
  delayMinutes: 2,
  sendMode: 'now',
  scheduledAt: toLocalInput(new Date(Date.now() + 60 * 60 * 1000)),
  frequency: 'once',
  requireOptIn: true,
  gdprMode: true,
};

function toLocalInput(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

