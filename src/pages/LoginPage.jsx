import { useId, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PasswordInput } from '../components/PasswordInput';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const {
    hasUsers,
    openSignup,
    passwordResetEnabled,
    login,
    signup,
    forgotPassword,
    bootstrapping,
  } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const nameId = useId();

  const allowSignup = !hasUsers || openSignup;
  const activeMode = !hasUsers ? 'signup' : mode;
  const isForgot = activeMode === 'forgot';
  const isSignup = activeMode === 'signup';
  const minPasswordLength = isSignup || isForgot ? 8 : 1;

  const emailError = touched.email && email && !EMAIL_PATTERN.test(email)
    ? 'Enter a valid email address'
    : '';
  const passwordError = touched.password && password.length > 0 && password.length < minPasswordLength
    ? `Password must be at least ${minPasswordLength} characters`
    : '';
  const confirmError = isForgot && confirmPassword.length > 0 && confirmPassword !== password
    ? 'Passwords do not match'
    : '';

  const formValid = isForgot
    ? EMAIL_PATTERN.test(email) && password.length >= 8 && confirmPassword === password
    : EMAIL_PATTERN.test(email) && password.length >= minPasswordLength;

  function switchMode(next) {
    setMode(next);
    setError('');
    setInfo('');
    setPassword('');
    setConfirmPassword('');
    setTouched({ email: false, password: false });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setInfo('');
    setTouched({ email: true, password: true });
    if (!formValid) return;

    setSubmitting(true);
    try {
      if (isForgot) {
        await forgotPassword(email, password);
        setInfo('If that account exists, the password has been reset. Sign in with your new password.');
        setMode('login');
        setPassword('');
        setConfirmPassword('');
        return;
      }
      if (isSignup) {
        await signup(email, password, name);
      } else {
        await login(email, password);
      }
      const target = searchParams.get('redirect') || '/';
      navigate(target, { replace: true });
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not complete request');
    } finally {
      setSubmitting(false);
    }
  }

  if (bootstrapping) {
    return (
      <div className="auth-shell">
        <p className="status-line" role="status">Loading…</p>
      </div>
    );
  }

  const heading = isForgot
    ? 'Reset password'
    : !hasUsers
      ? 'Create the first admin account'
      : isSignup
        ? 'Create your account'
        : 'Sign in to continue';

  const submitLabel = isForgot
    ? (submitting ? 'Resetting…' : 'Reset password')
    : isSignup
      ? (submitting ? 'Working…' : 'Create account')
      : (submitting ? 'Working…' : 'Sign in');

  return (
    <div className="auth-shell">
      <div className="auth-card surface">
        <div className="auth-brand">
          <img src="/posty-mark.svg" alt="" className="brand-mark" aria-hidden="true" />
          <div>
            <strong>Posty</strong>
            <span>{heading}</span>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          {isSignup && (
            <>
              <label htmlFor={nameId}>Your name (optional)</label>
              <input
                id={nameId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Avery Stone"
                autoComplete="name"
              />
            </>
          )}
          <label htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
            placeholder="you@example.com"
            autoComplete="email"
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? `${emailId}-err` : undefined}
          />
          {emailError && (
            <p id={`${emailId}-err`} className="field-error" role="alert">{emailError}</p>
          )}

          <label htmlFor={passwordId}>
            {isForgot ? 'New password' : 'Password'}
          </label>
          <PasswordInput
            id={passwordId}
            required
            minLength={minPasswordLength}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
            placeholder={isSignup || isForgot ? 'At least 8 characters' : '••••••••'}
            autoComplete={isSignup || isForgot ? 'new-password' : 'current-password'}
            aria-invalid={Boolean(passwordError)}
          />
          {passwordError && (
            <p className="field-error" role="alert">{passwordError}</p>
          )}

          {isForgot && (
            <>
              <label htmlFor={confirmId}>Confirm new password</label>
              <PasswordInput
                id={confirmId}
                required
                minLength={8}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Type the new password again"
                autoComplete="new-password"
                aria-invalid={Boolean(confirmError)}
              />
              {confirmError && (
                <p className="field-error" role="alert">{confirmError}</p>
              )}
            </>
          )}

          {info && <p className="auth-info" role="status">{info}</p>}
          {error && <p className="auth-error" role="alert">{error}</p>}

          <button className="primary" type="submit" disabled={submitting || !formValid}>
            {submitLabel}
          </button>

          <div className="auth-form-links">
            {!isForgot && hasUsers && passwordResetEnabled && (
              <button
                type="button"
                className="text-button"
                onClick={() => switchMode('forgot')}
              >
                Forgot password?
              </button>
            )}
            {isForgot && (
              <button
                type="button"
                className="text-button"
                onClick={() => switchMode('login')}
              >
                Back to sign in
              </button>
            )}
            {!isForgot && allowSignup && hasUsers && (
              <button
                type="button"
                className="text-button"
                onClick={() => switchMode(isSignup ? 'login' : 'signup')}
              >
                {isSignup ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
