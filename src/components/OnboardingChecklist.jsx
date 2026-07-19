import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronRight,
  Mail,
  MailCheck,
  Send,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { getSenderSetting } from '../services/brevoApi';
import { useAuth } from '../auth/AuthContext';

// First-run + ongoing onboarding checklist.
//
// Two display modes:
//   - 'full'   the hero card on a fresh dashboard (zero contacts, zero
//              campaigns). Replaces the legacy <Onboarding> first-run UI.
//   - 'banner' a compact strip shown above the regular dashboard when ANY
//              step is still incomplete. Lets users who finished steps out of
//              order (added contacts before configuring a sender, say) still
//              see the reminder until everything's done.
//
// Steps derive their done-state from real app state, not from a stored flag.
// That keeps the checklist honest: if the user deletes their sender in
// Settings, the "Configure sender" step un-checks itself automatically.
//
// The "dismissed" state lives in localStorage so it's a per-browser opt-out.
// Server-side persistence would be nicer but each user typically uses one
// browser; the trade-off favors zero extra schema for now.

const DISMISS_KEY = 'posty:onboarding-dismissed';

export function OnboardingChecklist({ mode = 'full', contacts, campaigns }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  // The sender lives behind the account-level Connections area. Only fetch +
  // show that step for users who can actually configure it — otherwise the
  // (connections-gated) sender request 403s and pops a scary "no access"
  // toast on the dashboard for editors, who can't act on it anyway.
  const canManageSender = can('connections');
  const [senderEffective, setSenderEffective] = useState(null);
  const [senderLoaded, setSenderLoaded] = useState(!canManageSender);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!canManageSender) return undefined;
    let cancelled = false;
    getSenderSetting()
      .then((data) => {
        if (cancelled) return;
        setSenderEffective(data?.effective || null);
      })
      .catch(() => {
        // Network errors mean we can't confirm the sender; treat as unknown
        // (un-checked) rather than erroring the checklist.
        if (cancelled) return;
        setSenderEffective(null);
      })
      .finally(() => {
        if (!cancelled) setSenderLoaded(true);
      });
    return () => { cancelled = true; };
  }, [canManageSender]);

  const steps = [
    ...(canManageSender ? [{
      id: 'sender',
      icon: Mail,
      label: 'Configure sender',
      detail: senderEffective
        ? `${senderEffective.name} <${senderEffective.email}>`
        : 'Set the From name and email recipients will see.',
      done: Boolean(senderEffective),
      cta: 'Open Settings',
      go: () => navigate('/settings'),
    }] : []),
    {
      id: 'audience',
      icon: Users,
      label: 'Add audience',
      detail: contacts.length
        ? `${contacts.length} ${contacts.length === 1 ? 'person' : 'people'} saved`
        : 'Import contacts from a CSV or add them one at a time.',
      done: contacts.length > 0,
      cta: 'Open Audience',
      go: () => navigate('/contacts'),
    },
    {
      id: 'campaign',
      icon: Send,
      label: 'Send your first campaign',
      detail: campaigns.length
        ? `${campaigns.length} ${campaigns.length === 1 ? 'campaign' : 'campaigns'} sent`
        : 'Build the email, pick recipients, and hit Send.',
      done: campaigns.length > 0,
      cta: 'Open Builder',
      go: () => navigate('/builder'),
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;
  const allDone = doneCount === steps.length;

  // Banner: hide entirely when complete or dismissed. Full: never hides
  // (it's the only thing on the page for first-run users; dismissing
  // would leave them looking at an empty dashboard).
  if (mode === 'banner' && (allDone || dismissed)) return null;

  // Still loading the sender state on first paint: show a skeleton step so
  // we don't briefly flash "Configure sender" as un-checked when it's
  // actually done.
  if (!senderLoaded && mode === 'full') {
    return (
      <section className="surface onboarding-card">
        <p className="muted">Loading setup state…</p>
      </section>
    );
  }

  function handleDismiss() {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode, fine */ }
  }

  if (mode === 'banner') {
    return (
      <section className="surface onboarding-banner">
        <div className="onboarding-banner-head">
          <strong>
            <Sparkles size={14} aria-hidden="true" /> Get the most out of Posty
          </strong>
          <span className="muted">
            {doneCount} of {steps.length} done
          </span>
          <button
            type="button"
            className="onboarding-dismiss"
            onClick={handleDismiss}
            aria-label="Dismiss onboarding checklist"
            title="Dismiss"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <ol className="onboarding-banner-steps">
          {steps.map((step) => (
            <li key={step.id} className={step.done ? 'is-done' : ''}>
              <button type="button" onClick={step.go} disabled={step.done}>
                <span className="onboarding-banner-check" aria-hidden="true">
                  {step.done && <Check size={12} />}
                </span>
                <span className="onboarding-banner-label">{step.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  // Full mode. Hero card for first-run users.
  return (
    <section className="surface onboarding-card">
      <div className="onboarding-card-head">
        <div>
          <span className="eyebrow muted">Welcome to Posty</span>
          <h2>{allDone ? 'You\'re all set up.' : `${steps.length} steps to your first send.`}</h2>
          <p className="muted">
            {allDone
              ? 'Send another campaign or check your reports.'
              : 'Knock these out and you\'re mailing in under five minutes.'}
          </p>
        </div>
        {allDone && (
          <span className="pill green">
            <MailCheck size={12} aria-hidden="true" /> Complete
          </span>
        )}
      </div>
      <ol className="onboarding-steps">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.id} className={step.done ? 'onboarding-step is-done' : 'onboarding-step'}>
              <span className="onboarding-step-index" aria-hidden="true">
                {step.done ? <Check size={14} /> : index + 1}
              </span>
              <div className="onboarding-step-body">
                <div className="onboarding-step-label">
                  <Icon size={14} aria-hidden="true" /> {step.label}
                </div>
                <div className="onboarding-step-detail muted">{step.detail}</div>
              </div>
              {!step.done && (
                <button type="button" className="primary" onClick={step.go}>
                  {step.cta} <ChevronRight size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
