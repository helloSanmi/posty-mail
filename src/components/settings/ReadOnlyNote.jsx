// One line under a section whose controls are disabled.
//
// The alternative is a page of controls that look operable and are not, which
// is how the built-in Editor experienced Settings: the bounce toggle flipped
// under their finger, 403'd, and flipped back. Disabling without explaining
// only converts "it is broken" into "it is broken differently".
export function ReadOnlyNote({ area }) {
  return (
    <p className="settings-readonly muted">
      Your role can view {area} but not change it. An admin can adjust this
      under Access.
    </p>
  );
}
