import { useState } from 'react';
import { MailX, PlugZap, ShieldOff, UserPlus } from 'lucide-react';
import { BounceSyncCard } from '../components/settings/BounceSyncCard';
import { BrevoApiStatusCard } from '../components/settings/BrevoApiStatusCard';
import { DeliverabilityCard } from '../components/settings/DeliverabilityCard';
import { PreferenceCenterCard } from '../components/settings/PreferenceCenterCard';
import { SenderCard } from '../components/settings/SenderCard';
import { SubscribeFormsCard } from '../components/settings/SubscribeFormsCard';
import { UnsubscribeListCard } from '../components/settings/UnsubscribeListCard';
import { WebhookCard } from '../components/settings/WebhookCard';

// Top-level Settings page. Just the section nav + a router that renders the
// right card(s) for the active section. Each card owns its own data
// fetching and state — SettingsPage stays a thin orchestrator instead of
// the 800-line god-component this used to be.
const SECTIONS = [
  {
    id: 'connections',
    label: 'Connections',
    icon: PlugZap,
    blurb: 'Webhooks and outbound integrations.',
  },
  {
    id: 'forms',
    label: 'Subscribe forms',
    icon: UserPlus,
    blurb: 'Embed a sign-up form on any website.',
  },
  {
    id: 'email',
    label: 'Email behavior',
    icon: ShieldOff,
    blurb: 'How bounces and complaints are handled.',
  },
  {
    id: 'unsubscribes',
    label: 'Unsubscribes',
    icon: MailX,
    blurb: 'People who should never be emailed, plus the preference center.',
  },
];

export function SettingsPage({ notify }) {
  const [active, setActive] = useState('connections');
  // Bumped after a sender save. DeliverabilityCard listens and re-reads its
  // "is sender configured?" probe so the Check button enables immediately
  // after a fresh setup, without a page refresh.
  const [senderEpoch, setSenderEpoch] = useState(0);

  return (
    <div className="page-stack content-page settings-page">
      <header className="settings-header">
        <h2>Settings</h2>
        <p className="muted">
          Wire up integrations and control how the app handles bounces and unsubscribes.
        </p>
      </header>

      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = active === section.id;
            return (
              <button
                key={section.id}
                type="button"
                className={`settings-nav-item${isActive ? ' is-active' : ''}`}
                onClick={() => setActive(section.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={16} aria-hidden="true" />
                <span className="settings-nav-label">
                  <strong>{section.label}</strong>
                  <small className="muted">{section.blurb}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="settings-content">
          {active === 'connections' && (
            <>
              <BrevoApiStatusCard />
              <SenderCard
                notify={notify}
                onChange={() => setSenderEpoch((n) => n + 1)}
              />
              <DeliverabilityCard senderEpoch={senderEpoch} />
              <WebhookCard notify={notify} />
            </>
          )}

          {active === 'forms' && <SubscribeFormsCard notify={notify} />}

          {active === 'email' && <BounceSyncCard notify={notify} />}

          {active === 'unsubscribes' && (
            <>
              <PreferenceCenterCard notify={notify} />
              <UnsubscribeListCard notify={notify} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
