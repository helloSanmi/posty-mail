import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Send } from 'lucide-react';
import { AdvancedSendSettings } from '../components/AdvancedSendSettings';
import { CampaignForm } from '../components/CampaignForm';
import { CampaignTabs } from '../components/CampaignTabs';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SendReview } from '../components/SendReview';
import { VariantsEditor } from '../components/VariantsEditor';
import { defaultTemplates } from '../templates/defaultTemplates';
import { chunkContacts, complianceIssues } from '../../shared/campaignUtils.js';
import {
  deleteDraft,
  getGroupContacts,
  getGroups,
  getSavedTemplates,
  saveDraft,
  scheduleCampaign,
  sendTestCampaignEmail,
} from '../services/brevoApi';

const AUTOSAVE_DEBOUNCE_MS = 800;

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
  const [groups, setGroups] = useState([]);
  // Recipients can be the union of zero or more groups. Empty array means
  // "all contacts" (the parent's full list); one or more means we union the
  // members of each selected group, deduped by email.
  const [selectedGroupIds, setSelectedGroupIds] = useState(() => {
    if (Array.isArray(draftFromNav?.groupIds)) return draftFromNav.groupIds;
    if (draftFromNav?.groupId) return [draftFromNav.groupId];
    return [];
  });
  const [groupContacts, setGroupContacts] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [variants, setVariants] = useState(draftFromNav?.variants || []);
  const [confirm, setConfirm] = useState(null);
  // 'idle' | 'saving' | 'saved' | 'error'
  const [saveState, setSaveState] = useState('idle');

  const contacts = groupContacts ?? allContacts;
  const batches = useMemo(() => chunkContacts(contacts, form.batchSize), [contacts, form.batchSize]);
  const held = useMemo(() => getHeldContacts(contacts, form).length, [contacts, form]);
  const readyContacts = Math.max(0, contacts.length - held);
  const canSchedule = readyContacts > 0;
  const templateOptions = [...defaultTemplates, ...savedTemplates];
  const selectedTemplateId = template.id || templateOptions[0]?.id || '';

  useEffect(() => {
    getSavedTemplates().then(setSavedTemplates).catch(() => setSavedTemplates([]));
    getGroups().then(setGroups).catch(() => setGroups([]));
    // Force the parent's contacts state to refresh. Its initial fetch happened
    // at app boot, so a contact added on the Audience page since then would not
    // be reflected in the audience count here.
    refreshContacts?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!selectedGroupIds.length) {
      setGroupContacts(null);
      return;
    }
    let cancelled = false;
    setGroupContacts(null); // show "Counting…" while we fetch
    Promise.all(selectedGroupIds.map((id) => getGroupContacts(id).catch(() => [])))
      .then((lists) => {
        if (cancelled) return;
        // Union by email so a contact in two selected groups isn't double-counted.
        // Exclusive group membership means this currently can't happen, but the
        // dedupe is cheap insurance against future additive modes.
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
          notify('Could not load group contacts', 'error');
          setSelectedGroupIds([]);
        }
      });
    return () => { cancelled = true; };
  }, [selectedGroupIds, notify]);

  // Debounced autosave to the Draft table. On a fresh /builder visit there is
  // no draft id yet. The first autosave creates one. On a Resume click the
  // draft id is already set from `state.draft` and subsequent saves upsert
  // that same row. Since /builder no longer auto-resumes via localStorage,
  // every fresh visit creates a NEW draft, which is exactly how the user
  // accumulates multiple drafts in the Drafts list.
  useEffect(() => {
    const snapshot = JSON.stringify({
      form, selectedGroupIds, variants, testEmail, showAdvanced,
      templateId: template.id,
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
          variants,
          testEmail,
          showAdvanced,
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
  }, [form, selectedGroupIds, variants, testEmail, showAdvanced, template.id]);

  function requestSchedule() {
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
        variants,
        testEmail,
        showAdvanced,
      });
      if (!draftIdRef.current) draftIdRef.current = saved.id;
      lastSavedSnapshotRef.current = JSON.stringify({
        form, selectedGroupIds, variants, testEmail, showAdvanced, templateId: template.id,
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
    if (selected) setTemplate(selected);
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
            groups={groups}
            selectedGroupIds={selectedGroupIds}
            onSelectGroups={setSelectedGroupIds}
            recipientCount={readyContacts}
            recipientLoading={selectedGroupIds.length > 0 && groupContacts === null}
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
            <button type="button" onClick={requestTestEmail}>Send test</button>
          </div>
          <VariantsEditor
            variants={variants}
            onChange={setVariants}
            baseTemplate={template}
          />
          {showAdvanced && <AdvancedSendSettings form={form} setForm={setForm} />}
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
              disabled={!canSchedule || submitting}
            >
              <Send size={18} aria-hidden="true" />
              {submitting ? 'Scheduling…' : (canSchedule ? (form.sendMode === 'now' ? 'Send now' : 'Schedule send') : 'Add audience first')}
            </button>
            {status && <span className="inline-status" role="status">{status}</span>}
          </div>
        </div>
        <SendReview
          readyContacts={readyContacts}
          template={template}
          frequency={form.frequency}
          held={held}
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
    </div>
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

function getHeldContacts(contacts, form) {
  return contacts.filter((contact) => {
    return complianceIssues(contact, {
      requireOptIn: form.requireOptIn,
      gdprMode: form.gdprMode,
    }).length > 0;
  });
}

function buildCampaignPayload(form, contacts, template, variants) {
  const scheduledAt = form.sendMode === 'now'
    ? new Date().toISOString()
    : new Date(form.scheduledAt).toISOString();

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
  };
}

const initialForm = {
  name: 'New campaign',
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

