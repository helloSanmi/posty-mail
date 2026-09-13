import { useState } from 'react';
import { MailX, PlugZap, ShieldOff, UserPlus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useViewState } from '../hooks/useViewState';
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
    permission: 'forms',
  },
  {
    id: 'email',
    label: 'Email behavior',
    icon: ShieldOff,
    // Bounce handling. Separate from the forms builder because seeing which
    // addresses are bouncing is a different kind of access from generating
    // a signup snippet.
    permission: 'bounces',
  },
  {
    id: 'unsubscribes',
    label: 'Unsubscribes',
    icon: MailX,
    permission: 'unsubscribes',
  },
];

export function SettingsPage({ notify }) {
  const { can } = useAuth();
  // Only show sections the current role can reach. Settings used to be ONE
  // permission covering all four of these, so "an Editor shouldn't see the
  // sender identity, but should see which addresses bounced" had no answer.
  // Each section now carries its own area.
  //
  // A section with no `permission` is open to everyone — can(undefined) is
  // false, so this has to be explicit rather than relying on the call.
  const sections = SECTIONS.filter(
    (section) => !section.permission || can(section.permission),
  );
  // In the URL, so a refresh keeps you in the section you were editing and
  // "the bounce settings are here" is a link someone can send.
  //
  // alwaysWrite, unusually — because the default is computed from the
  // sections this ROLE can see. A bare /settings means Connections to an
  // admin and Subscribe forms to an Editor, so leaving the default implicit
  // would have two people believing they shared the same page. Writing it
  // out makes the link say which one it meant.
  //
  // The allowlist is `sections`, not SECTIONS: ?section=connections for an
  // Editor must fall back to a section they can open, not paint an empty
  // pane with nothing highlighted in the nav.
  const [view, setView] = useViewState({
    section: {
      fallback: sections[0]?.id || 'forms',
      allow: sections.map((section) => section.id),
      alwaysWrite: true,
    },
  });
  const active = view.section;
  const setActive = (id) => setView({ section: id });
  // Bumped after a sender save. DeliverabilityCard listens and re-reads its
  // "is sender configured?" probe so the check enables immediately after a
  // fresh setup, without a page refresh.
  const [senderEpoch, setSenderEpoch] = useState(0);

  // Feeds the topbar eyebrow, so the shell says which section is open
  // rather than repeating the page name.
  // No topbar eyebrow. It named the active section — and the section is
  // already named, in the tab strip directly below it, where the active
  // one is highlighted. Two labels for one thing, a centimetre apart.

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

          {/* readOnly, not just visible.
              A role with `read` on an area could open its section and operate
              every control in it — the built-in Editor holds bounces:'read'
              and unsubscribes:'read', so the bounce-sync toggle flipped under
              their finger, 403'd, and flipped back. Three sections of
              controls that all fail is worse than three sections they cannot
              reach: it reads as a broken app rather than as access they do
              not have. */}
          {active === 'forms' && can('forms') && (
            <SubscribeFormsCard notify={notify} readOnly={!can('forms', 'write')} />
          )}

          {active === 'email' && can('bounces') && (
            <BounceSyncCard notify={notify} readOnly={!can('bounces', 'write')} />
          )}

          {active === 'unsubscribes' && can('unsubscribes') && (
            <>
              <PreferenceCenterCard notify={notify} readOnly={!can('unsubscribes', 'write')} />
              <UnsubscribeListCard notify={notify} readOnly={!can('unsubscribes', 'manage')} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
