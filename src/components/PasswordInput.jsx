// Password input with a built-in "show / hide" toggle. Same prop surface
// as a plain <input> (forward everything via ...rest), plus the toggle
// button is hard-wired to flip the type between 'password' and 'text'.
// Used on login, signup, the reset page, and the change-password flows so
// visibility behaves the same everywhere.
//
// forwardRef so the ref lands on the <input>, making "same prop surface as a
// plain input" true of refs as well as props. ResetPasswordPage needs it: that
// page cannot use autoFocus, because the field does not exist at mount while
// the token check is in flight, so it focuses via a ref once the form renders.
// Without forwardRef the ref is silently dropped and focus never lands.
import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export const PasswordInput = forwardRef(function PasswordInput({ id, ...rest }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="password-input">
      <input
        id={id}
        ref={ref}
        type={visible ? 'text' : 'password'}
        {...rest}
      />
      <button
        type="button"
        className="password-input-toggle"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </span>
  );
});
