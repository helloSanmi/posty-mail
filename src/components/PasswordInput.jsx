// Password input with a built-in "show / hide" toggle. Same prop surface
// as a plain <input> (forward everything via ...rest), plus the toggle
// button is hard-wired to flip the type between 'password' and 'text'.
// Used on login, signup, forgot-password, and the change-password flows
// inside UserModals so visibility behaves the same everywhere.
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function PasswordInput({ id, ...rest }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="password-input">
      <input
        id={id}
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
}
