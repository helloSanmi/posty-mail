import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Check, ChevronDown, Eye, Send, Users,
} from 'lucide-react';
import { CampaignTabs } from '../components/CampaignTabs';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DateTimePicker } from '../components/DateTimePicker';
import { GroupSelector } from '../components/GroupSelector';
import { InboxPreviewModal } from '../components/InboxPreviewModal';
import { VariantsEditor } from '../components/VariantsEditor';
import { defaultTemplates } from '../templates/defaultTemplates';
import { chunkContacts, complianceIssues } from '../../shared/campaignUtils.js';
import { readinessToChecks } from '../utils/sendReadiness';
import {
  deleteDraft,
  getGroupContacts,
  getGroups,
  getHiddenBuiltinTemplates,
  getSavedTemplates,
  getSegmentContacts,
  getSegments,
  getSendReadiness,
  preflightCampaign,
  saveDraft,
  scheduleCampaign,
  sendTestCampaignEmail,
} from '../services/brevoApi';

// Pre-send checks render in severity order so the row blocking Send is
// always first, regardless of which subsystem produced it.
const SEVERITY_RANK = { error: 0, warn: 1, info: 2 };

// The form is four steps: what to send, who receives it, when it goes, and
// then checking and sending. They are steps, not an accordion — everything
// stays visible and editable, because you do revisit the name after picking
// recipients. Sections are separated by a hairline and space rather than by
// nested boxes, so there is one card on the left and one review rail on the
// right. A/B variants and the sending-rate settings are genuinely occasional,
// so they collapse into disclosures below the steps.

const AUTOSAVE_DEBOUNCE_MS = 800;
const PREFLIGHT_DEBOUNCE_MS = 600;

const FREQUENCY_LABEL = {
  once: 'Once',
  daily: 'Daily at this time',
  weekly: 'Weekly on this weekday',
  monthly: 'Monthly on this day',
};

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
  // Send readiness (provider key working? sender configured + verified?),
  // fetched once. Surfaced as pre-send checks so a rejected key / unverified
  // sender is caught here rather than as a silent failure at send time.
  const [readiness, setReadiness] = useState(null);
  // Inbox-preview modal open/closed.
  const [previewOpen, setPreviewOpen] = useState(false);
  // Recipients popover (step 2). Anchored to the picker button.
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const recipientsRef = useRef(null);
  // The two disclosures under the steps. A/B starts open when the restored
  // draft already carries variants, so resuming never hides saved work.
  const [showVariants, setShowVariants] = useState(
    () => Array.isArray(draftFromNav?.variants) && draftFromNav.variants.length > 0,
  );

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
  // Combine template lint (from the backend) with send-readiness checks so
  // both show in one panel and both can block Send on error severity.
  // Severity order, not source order. These two lists were concatenated by
  // where each check came from — readiness first, backend preflight second —
  // which put an 'info' note above the very error disabling Send. The row
  // that blocks the send has to be the first row.
  const allChecks = useMemo(
    () => [...readinessToChecks(readiness), ...(preflight?.checks || [])]
      .slice()
      .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)),
    [readiness, preflight],
  );
  const preflightErrors = allChecks.filter((c) => c.severity === 'error');
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
  // Groups an admin has disabled stay out of the picker, but a group that was
  // already selected keeps its name in the trigger summary.
  const activeGroups = groups.filter((g) => !g.disabled);
  const recipientLoading = (selectedGroupIds.length > 0 || selectedSegmentIds.length > 0) && groupContacts === null;

  useEffect(() => {
    getSavedTemplates().then(setSavedTemplates).catch(() => setSavedTemplates([]));
    getHiddenBuiltinTemplates()
      .then((ids) => setHiddenBuiltins(new Set(Array.isArray(ids) ? ids : [])))
      .catch(() => setHiddenBuiltins(new Set()));
    getGroups().then(setGroups).catch(() => setGroups([]));
    getSegments().then(setSegments).catch(() => setSegments([]));
    getSendReadiness().then(setReadiness).catch(() => setReadiness(null));
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

  // Close the recipients popover on outside click or Escape.
  useEffect(() => {
    if (!recipientsOpen) return undefined;
    function onPointer(event) {
      if (!recipientsRef.current?.contains(event.target)) setRecipientsOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setRecipientsOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [recipientsOpen]);

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

  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
    } catch {
      return 'Local time';
    }
  }, []);

  // Plain-language restatement of the schedule, including the "that's in the
  // past" warning — the one place the builder tells you what the date you
  // typed actually means.
  const scheduleSummary = useMemo(() => {
    if (form.sendMode === 'now') return null;
    if (!form.scheduledAt) return 'Pick a date and time.';
    const date = new Date(form.scheduledAt);
    if (Number.isNaN(date.getTime())) return 'Invalid date.';
    const formatted = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
    if (date.getTime() <= Date.now()) {
      return `${formatted}. That's in the past, will send immediately.`;
    }
    return `${formatted} (${timezone}) · ${FREQUENCY_LABEL[form.frequency] || 'Once'}`;
  }, [form.sendMode, form.scheduledAt, form.frequency, timezone]);

  // What the recipients picker says on its face: the selection on the first
  // line, what it resolves to on the second.
  const selectedNames = useMemo(() => {
    const names = [];
    for (const id of selectedGroupIds) {
      const match = groups.find((group) => group.id === id);
      if (match) names.push(match.name);
    }
    for (const id of selectedSegmentIds) {
      const match = segments.find((segment) => segment.id === id);
      if (match) names.push(match.name);
    }
    return names;
  }, [groups, segments, selectedGroupIds, selectedSegmentIds]);

  const recipientsLabel = (() => {
    if (!recipientsChosen) return 'Select recipients';
    if (!selectedGroupIds.length && !selectedSegmentIds.length) return 'All contacts';
    if (selectedNames.length) return selectedNames.join(', ');
    // Names haven't loaded yet — fall back to counts so the trigger is never blank.
    const parts = [];
    if (selectedGroupIds.length) {
      parts.push(`${selectedGroupIds.length} group${selectedGroupIds.length === 1 ? '' : 's'}`);
    }
    if (selectedSegmentIds.length) {
      parts.push(`${selectedSegmentIds.length} segment${selectedSegmentIds.length === 1 ? '' : 's'}`);
    }
    return parts.join(' · ');
  })();

  const recipientsResolved = !recipientsChosen
    ? 'Nobody selected yet'
    : recipientLoading
      ? 'Counting…'
      : `${peopleLabel(readyContacts)}${held > 0 ? ' after suppressions' : ''}`;

  const sendLabel = submitting
    ? 'Scheduling…'
    : !canSchedule
      ? 'Add audience first'
      : form.sendMode === 'now'
        ? `Send to ${peopleLabel(readyContacts)}`
        : `Schedule for ${formatScheduledShort(form.scheduledAt)}`;

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
      {/* The page needs its own h2. Without it the only heading on screen is
          the rail's "Review", so heading navigation lands on the sidebar and
          the form sits under a title naming something else. CampaignTabs
          renders a <nav>, not a heading. */}
      <h2 className="bd-page-title">Create campaign</h2>
      {/* The blocker sits above the card rather than inside it: a page-level
          warning, not a box nested in the form. */}
      {!canSchedule && <AudienceBlocker setPage={setPage} />}
      <div className="bd-grid">
        <section className="bd-card">
          <ol className="bd-steps">
            <li className="bd-step">
              <span className="bd-step-head">
                <span className="bd-step-n">1</span>
                <span className="bd-step-title">What to send</span>
              </span>
              <div className="bd-step-body">
                <label className="bd-field">
                  Campaign name
                  <input
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    placeholder="Name this campaign"
                  />
                </label>
                <label className="bd-field">
                  Email template
                  <select value={selectedTemplateId} onChange={selectTemplate}>
                    {!templateChosen && (
                      <option value="" disabled>Select template…</option>
                    )}
                    {templateOptions.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </li>

            <li className="bd-step">
              <span className="bd-step-head">
                <span className="bd-step-n">2</span>
                <span className="bd-step-title">Who receives it</span>
              </span>
              <div className="bd-step-body">
                {/* One control that states what is selected AND what it
                    resolves to, so the count that matters is on the button. */}
                <div className="send-recipients-field bd-field-wide" ref={recipientsRef}>
                  <button
                    type="button"
                    className="bd-picker"
                    onClick={() => setRecipientsOpen((value) => !value)}
                    aria-expanded={recipientsOpen}
                    aria-haspopup="dialog"
                  >
                    <Users size={15} aria-hidden="true" />
                    <span className="bd-picker-text">
                      <span>
                        <span className="visually-hidden">Recipients: </span>
                        {recipientsLabel}
                      </span>
                      <span className="bd-dim">{recipientsResolved}</span>
                    </span>
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                  {recipientsOpen && (
                    <div className="send-recipients-popover" role="dialog" aria-label="Choose recipients">
                      <GroupSelector
                        compact
                        groups={activeGroups}
                        selectedIds={selectedGroupIds}
                        onChange={(ids) => handleSelectGroups(ids)}
                        showAllContactsOption
                        emptyMessage="No groups yet. This campaign will go to All contacts."
                      />
                      {segments.length > 0 && (
                        <div className="recipients-segments">
                          <div className="recipients-segments-head">
                            <strong>Segments</strong>
                            <span className="muted">Add a dynamic list. Re-evaluated at send time.</span>
                          </div>
                          <ul className="recipients-segments-list">
                            {segments.map((segment) => {
                              const checked = selectedSegmentIds.includes(segment.id);
                              return (
                                <li key={segment.id}>
                                  <label className={`recipients-segment-row${checked ? ' is-checked' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => {
                                        const next = checked
                                          ? selectedSegmentIds.filter((id) => id !== segment.id)
                                          : [...selectedSegmentIds, segment.id];
                                        handleSelectSegments(next);
                                      }}
                                    />
                                    <span>{segment.name}</span>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>

            <li className="bd-step">
              <span className="bd-step-head">
                <span className="bd-step-n">3</span>
                <span className="bd-step-title">When it goes</span>
              </span>
              <div className="bd-step-body">
                <div className="bd-choice" role="group" aria-label="When to send">
                  {[['now', 'Send now'], ['schedule', 'Schedule']].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`bd-choice-btn${form.sendMode === key ? ' is-active' : ''}`}
                      aria-pressed={form.sendMode === key}
                      onClick={() => setForm({ ...form, sendMode: key })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {form.sendMode === 'schedule' && (
                  <div className="bd-schedule">
                    <div className="bd-field">
                      <span>Send date &amp; time</span>
                      <DateTimePicker
                        value={form.scheduledAt}
                        onChange={(next) => setForm({ ...form, scheduledAt: next })}
                        min={toLocalInput(new Date())}
                      />
                    </div>
                    <label className="bd-field">
                      Repeat
                      <select
                        value={form.frequency}
                        onChange={(event) => setForm({ ...form, frequency: event.target.value })}
                      >
                        <option value="once">Once</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </label>
                    {scheduleSummary && (
                      <span className="bd-dim bd-field-wide">{scheduleSummary}</span>
                    )}
                    {/* Send-time per recipient timezone. Treats the chosen hour as a
                        local-clock target. Each contact receives when their wall clock
                        hits that time. Contacts with no stored timezone fall back to UTC. */}
                    <label className="bd-check bd-field-wide">
                      <input
                        type="checkbox"
                        checked={Boolean(form.useRecipientTimezone)}
                        onChange={(event) => setForm({ ...form, useRecipientTimezone: event.target.checked })}
                      />
                      Send at each recipient&apos;s local time
                      <span className="bd-dim">(uses the stored timezone on each contact; UTC otherwise)</span>
                    </label>
                  </div>
                )}
              </div>
            </li>

            <li className="bd-step">
              <span className="bd-step-head">
                <span className="bd-step-n">4</span>
                <span className="bd-step-title">Check and send</span>
              </span>
              <div className="bd-step-body">
                <div className="bd-test">
                  <label className="bd-field">
                    Send a test to
                    <input
                      type="email"
                      value={testEmail}
                      onChange={(event) => setTestEmail(event.target.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                  <button type="button" className="bd-btn" onClick={requestTestEmail}>Send test</button>
                  <button
                    type="button"
                    className="bd-btn"
                    onClick={() => setPreviewOpen(true)}
                    disabled={!template?.html}
                    title={template?.html
                      ? 'See how it renders in Gmail, Outlook, and Apple Mail'
                      : 'Pick a template first'}
                  >
                    <Eye size={14} aria-hidden="true" /> Inbox preview
                  </button>
                </div>
              </div>
            </li>
          </ol>

          <div className="bd-extras">
            <button
              type="button"
              className={`bd-disclose${showVariants ? ' is-open' : ''}`}
              aria-expanded={showVariants}
              onClick={() => setShowVariants((value) => !value)}
            >
              <ChevronDown size={14} aria-hidden="true" /> A/B test the subject line
            </button>
            {showVariants && (
              <VariantsEditor
                variants={variants}
                onChange={setVariants}
                baseTemplate={template}
              />
            )}

            <button
              type="button"
              className={`bd-disclose${showAdvanced ? ' is-open' : ''}`}
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((value) => !value)}
            >
              <ChevronDown size={14} aria-hidden="true" /> Sending rate and consent
            </button>
            {showAdvanced && (
              <div className="bd-panel">
                <label className="bd-field">
                  Batch size
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={form.batchSize}
                    onChange={(event) => setForm({ ...form, batchSize: event.target.value })}
                  />
                </label>
                <label className="bd-field">
                  Delay minutes
                  <input
                    type="number"
                    min="0"
                    max="60"
                    value={form.delayMinutes}
                    onChange={(event) => setForm({ ...form, delayMinutes: event.target.value })}
                  />
                </label>
                <label className="bd-check bd-field-wide">
                  <input
                    type="checkbox"
                    checked={form.requireOptIn}
                    onChange={(event) => setForm({ ...form, requireOptIn: event.target.checked })}
                  />
                  Only send to opted-in people
                </label>
                <label className="bd-check bd-field-wide">
                  <input
                    type="checkbox"
                    checked={form.gdprMode}
                    onChange={(event) => setForm({ ...form, gdprMode: event.target.checked })}
                  />
                  Apply EU/UK consent checks
                </label>
              </div>
            )}
          </div>
        </section>

        <aside className="bd-card bd-review">
          <div className="bd-review-head">
            <h2>Review</h2>
          </div>

          <dl className="bd-summary">
            <div><dt>Email</dt><dd>{template.name || 'Selected email'}</dd></div>
            <div>
              <dt>Recipients</dt>
              <dd>{recipientLoading ? 'Counting…' : peopleLabel(readyContacts)}</dd>
            </div>
            <div>
              <dt>Sending</dt>
              <dd>{form.sendMode === 'now' ? 'Immediately' : formatScheduledAt(form.scheduledAt)}</dd>
            </div>
            <div>
              <dt>Repeat</dt>
              <dd>{form.frequency === 'once' ? 'Once' : form.frequency}</dd>
            </div>
            <div>
              <dt>Not included</dt>
              <dd>{held ? peopleLabel(held) : '0 people'}</dd>
            </div>
            <div><dt>Send batches</dt><dd>{batches.length}</dd></div>
          </dl>

          {/* Both counts above stay clickable: who is about to receive this,
              and who is being held back and for which compliance reason. */}
          <PeopleDisclosure
            label={`Show the ${peopleLabel(readyContacts)} receiving this`}
            people={readyList}
          />
          <PeopleDisclosure
            label={`Why ${peopleLabel(held)} ${held === 1 ? 'is' : 'are'} not included`}
            people={heldList.map((entry) => ({ ...entry.contact, reasons: entry.reasons }))}
            tone="held"
          />

          <ul className="bd-checks" role="status" aria-label="Pre-send checks">
            {allChecks.length === 0 ? (
              <li className="bd-checkrow">
                <span className="bd-checkmark" aria-hidden="true"><Check size={11} /></span>
                <span className="bd-checktext">
                  Pre-send checks passed
                  <span className="bd-dim">Subject, unsubscribe, size, links, images all look good.</span>
                </span>
              </li>
            ) : allChecks.map((check) => {
              const ok = check.severity === 'info';
              // error and warn are not the same thing: an error is what is
              // disabling Send. Flattening both to amber left only the
              // sr-only prefix to distinguish a blocker from a suggestion.
              const tone = ok ? '' : (check.severity === 'error' ? ' is-error' : ' is-warn');
              return (
                <li key={check.code} className={`bd-checkrow${tone}`}>
                  <span className="bd-checkmark" aria-hidden="true">
                    {ok ? <Check size={11} /> : '!'}
                  </span>
                  <span className="bd-checktext">
                    <span>
                      <span className="visually-hidden">{`${SEVERITY_LABEL[check.severity] || 'Note'}: `}</span>
                      {check.message}
                    </span>
                    {check.hint && <span className="bd-dim">{check.hint}</span>}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* One primary action, and the consequence stated on it rather than
              in a sentence above it. "Emails will start going out immediately.
              This cannot be undone." belongs in the confirm step, not on the
              form — and that is where it still lives. */}
          <button
            type="button"
            className="bd-send"
            onClick={requestSchedule}
            disabled={!readyToSchedule || submitting}
          >
            <Send size={15} aria-hidden="true" />
            {sendLabel}
          </button>

          <div className="actions-row send-secondary-actions">
            <button type="button" className="bd-btn" onClick={handleSaveDraft}>Save draft</button>
            <SaveIndicator state={saveState} />
            {status && <span className="inline-status" role="status">{status}</span>}
          </div>
        </aside>
      </div>

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

const SEVERITY_LABEL = { error: 'Error', warn: 'Warning', info: 'Note' };

// A count in the review rail that opens into the actual list of people, so
// the admin can eyeball who is about to receive (or be skipped by) the send.
// Held contacts carry the compliance reason they were excluded for.
function PeopleDisclosure({ label, people, tone }) {
  const [open, setOpen] = useState(false);
  if (!people.length) return null;
  return (
    <>
      <button
        type="button"
        className={`bd-disclose${open ? ' is-open' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={14} aria-hidden="true" /> {label}
      </button>
      {open && (
        <ul className={`review-people-list${tone === 'held' ? ' is-held' : ''}`}>
          {people.map((person) => {
            const fullName = [person.firstname, person.lastname].filter(Boolean).join(' ');
            return (
              <li key={person.email} className="review-people-item">
                <span className="review-people-avatar" aria-hidden="true">
                  {(person.firstname || person.email || '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="review-people-text">
                  {fullName && <strong>{fullName}</strong>}
                  <span className="review-people-email">{person.email}</span>
                  {Array.isArray(person.reasons) && person.reasons.length > 0 && (
                    <span className="review-people-reason">{person.reasons.join(' · ')}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function SaveIndicator({ state }) {
  if (state === 'saving') return <span className="muted save-indicator">Saving…</span>;
  if (state === 'saved') return <span className="muted save-indicator">Saved</span>;
  if (state === 'error') return <span className="save-indicator save-indicator-error">Save failed. Will retry on next change</span>;
  return null;
}

function peopleLabel(count) {
  return `${count.toLocaleString()} ${count === 1 ? 'person' : 'people'}`;
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

// Short form for the send button, where the whole consequence has to fit on
// one line: "Schedule for 14 Sep, 09:00".
function formatScheduledShort(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return 'the scheduled time';
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
