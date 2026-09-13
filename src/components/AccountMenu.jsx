import { useEffect, useId, useRef, useState } from 'react';
import { LogOut, UserRound } from 'lucide-react';

// The account control, top right.
//
// It used to be a block pinned to the bottom of the sidebar: avatar, name,
// role, and a bare icon button that signed you out. Two problems with that.
// The first is conventional — every app of this shape puts the account at the
// top right, so people go looking there, and a sign-out button in the
// navigation rail is one mis-click away from a page you meant to open. The
// second is that it was not a MENU: the only thing you could do was leave.
//
// This is only the trigger and the menu. "Your profile" is a PAGE at
// /profile, and this component deliberately does not know that route — it
// calls onOpenProfile and the shell decides. That keeps a control which is
// mounted on every screen free of router coupling, and renderable in a test
// with no router around it.
export function initialsOf(user) {
  const source = String(user?.name || user?.email || '').trim();
  if (!source) return '?';
  const local = source.split('@')[0];
  const parts = local.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]).join('');
  return (letters || local[0]).toUpperCase();
}

export function AccountMenu({ user, roleName, onSignOut, onOpenProfile }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();

  // Same dismissal contract as the notification bell beside it: press
  // outside, or Escape. Two popovers in one topbar behaving differently is
  // the kind of small inconsistency people feel without being able to name.
  useEffect(() => {
    if (!open) return undefined;
    function onOutside(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Focus goes back to the trigger, or it lands on <body> and the next
      // Tab starts from the top of the page.
      buttonRef.current?.focus();
    }
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const displayName = user.name || user.email;

  return (
    <>
      <div className="sh-account" ref={containerRef}>
        <button
          type="button"
          ref={buttonRef}
          className="sh-account-trigger"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-controls={open ? menuId : undefined}
          // The visible content is two letters, which say nothing to a
          // screen reader — so the accessible name carries the whole thing.
          aria-label={`Account: ${displayName}`}
          title={displayName}
        >
          <span className="sh-avatar" aria-hidden="true">{initialsOf(user)}</span>
        </button>

        {open && (
          <div className="sh-account-menu" id={menuId} role="menu">
            <div className="sh-account-head">
              <span className="sh-avatar sh-avatar-lg" aria-hidden="true">{initialsOf(user)}</span>
              <span className="sh-account-who">
                <strong>{displayName}</strong>
                {/* The email is repeated under the name only when the name
                    is not already the email — otherwise it is the same
                    string twice. */}
                {user.name && <span className="sh-account-email">{user.email}</span>}
                <span className="sh-account-role">{roleName || user.role}</span>
              </span>
            </div>

            <button
              type="button"
              role="menuitem"
              className="sh-account-item"
              onClick={() => { setOpen(false); onOpenProfile(); }}
            >
              <UserRound size={15} aria-hidden="true" />
              Your profile
            </button>

            <button
              type="button"
              role="menuitem"
              className="sh-account-item is-danger"
              onClick={() => { setOpen(false); onSignOut(); }}
            >
              <LogOut size={15} aria-hidden="true" />
              Sign out
            </button>
          </div>
        )}
      </div>

    </>
  );
}
