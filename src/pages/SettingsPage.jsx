import { useState } from 'react';
import { MailX, PlugZap, ShieldOff, UserPlus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { usePageSectionLabel } from '../components/PageSectionContext';
import { BounceSyncCard } from '../components/settings/BounceSyncCard';
import { DeliverabilityCard } from '../components/settings/DeliverabilityCard';
import { PreferenceCenterCard } from '../components/settings/PreferenceCenterCard';
import { SendingCard } from '../components/settings/SendingCard';
import { SubscribeFormsCard } from '../components/settings/SubscribeFormsCard';
import { UnsubscribeListCard } from '../components/settings/UnsubscribeListCard';
import { WebhookCard } from '../components/settings/WebhookCard';

// Top-level Settings page. Just the section nav + a router that renders the
// right group(s) for the active section. Each group owns its own data
// fetching and state — SettingsPage stays a thin orchestrator instead of
// the 800-line god-component this used to be.
//
// There is no page heading here on purpose. The topbar already renders
// "Settings", and the eyebrow above it names the active section, so an h2
// saying "Settings" was the third copy of the same word on screen. The nav
// items lost their blurbs for the same reason: a one-line description under
// every item added four sentences to explain four labels that already read
// clearly.
const SECTIONS = [
  {
    id: 'connections',
    label: 'Connections',
    icon: PlugZap,
    // Sender identity, deliverability, the outbound webhook — account-level
    // plumbing behind the `connections` area. Editors don't get it.
    permission: 'connections',
  },
  {
    id: 'forms',
    label: 'Subscribe forms',
    icon: UserPlus,
    permission: 'settings',
  },
  {
    id: 'email',
    label: 'Email behavior',
    icon: ShieldOff,
    permission: 'settings',
  },
  {
    id: 'unsubscribes',
    label: 'Unsubscribes',
    icon: MailX,
    permission: 'settings',
  },
];

export function SettingsPage({ notify }) {
  const { can } = useAuth();
  // Only show sections the current role can reach (Connections needs the
  // `connections` area; the rest need `settings`).
  const sections = SECTIONS.filter((section) => can(section.permission));
  // Land on the first section the user can actually see.
  const [active, setActive] = useState(sections[0]?.id || 'forms');
  // Bumped after a sender save. DeliverabilityCard listens and re-reads its
  // "is sender configured?" probe so the check enables immediately after a
  // fresh setup, without a page refresh.
  const [senderEpoch, setSenderEpoch] = useState(0);

  // Feeds the topbar eyebrow, so the shell says which section is open
  // rather than repeating the page name.
  const activeLabel = sections.find((section) => section.id === active)?.label;
  usePageSectionLabel(activeLabel);

  return (
    <div className="page-stack content-page settings-page">
      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map((section) => {
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
                <span className="settings-nav-label">{section.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="settings-content">
          {active === 'connections' && can('connections') && (
            <>
              <SendingCard
                notify={notify}
                onSenderChange={() => setSenderEpoch((n) => n + 1)}
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
