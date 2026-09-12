import { useId, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PasswordInput } from '../components/PasswordInput';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The brand line under the heading. On a self-hosted install the one thing
// the screen can usefully add is WHICH install you are signing into, which
// is why it replaces the old subheading rather than sitting beside it.
const INSTALL_NAME = 'Posty';

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
      const authedUser = isSignup
        ? await signup(email, password, name)
        : await login(email, password);
      // Resume a deep-link if there was one, but never drop someone onto a
      // page their role can't use (a stale ?redirect=/admin from a prior
      // session, say) — fall back to Home in that case.
      let target = searchParams.get('redirect') || '/';
      const privileged = (
        (target.startsWith('/admin') && authedUser?.role !== 'admin')
        || (target.startsWith('/workspaces') && !authedUser?.isSuperAdmin)
      );
      if (privileged) target = '/';
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
    ? 'Reset your password'
    : !hasUsers
      ? 'Create the first admin account'
      : isSignup
        ? 'Create your account'
        : 'Welcome back';

  // The sign-in subheading DID say the heading twice ("Sign in" over "Sign
  // in to your Posty workspace") and deserved to go. The other three did
  // not: each is the only on-screen text explaining what the flow will
  // actually do — most importantly that reset sets a new password here and
  // now rather than emailing a link. So sign-in gets the install name, and
  // the states that need instructing keep it.
  const subheading = isForgot
    ? 'Enter your email and a new password to regain access.'
    : !hasUsers
      ? 'This first account becomes the workspace admin.'
      : isSignup
        ? 'Set up a new workspace in a few seconds.'
        : INSTALL_NAME;

  const submitLabel = isForgot
    ? (submitting ? 'Resetting…' : 'Reset password')
    : isSignup
      ? (submitting ? 'Working…' : 'Create account')
      : (submitting ? 'Working…' : 'Sign in');

  // One row of links, not a divider plus a stack. Only two of the three can
  // ever be showing at once (the back-link owns the forgot mode outright),
  // so a single separator between them is all the row needs.
  const showForgotLink = !isForgot && hasUsers && passwordResetEnabled;
  const showBackLink = isForgot;
  const showSignupLink = !isForgot && allowSignup && hasUsers;
  const showLinkRow = showForgotLink || showBackLink || showSignupLink;

  return (
    <div className="auth-shell">
      {/* The card IS the form — the design collapsed the card/form pair into
          one element so .sm-authcard's own grid owns the field rhythm.
          .auth-card rides along for its margin:auto, the one property
          .sm-authcard does not set and the thing that centres the card in
          the full-height shell (the design sandbox had no viewport to
          centre in). .surface keeps the entrance animation; every visual
          property of both is overridden by .sm-authcard. */}
      <form className="sm-authcard auth-card surface" onSubmit={handleSubmit} noValidate>
        <div className="sm-authbrand">
          <img src="/posty-mark.svg" alt="Posty" className="auth-logo" />
          <h1>{heading}</h1>
          <span className="sm-dim">{subheading}</span>
        </div>

        {isSignup && (
          <label className="sm-field" htmlFor={nameId}>
            Your name (optional)
            <input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Avery Stone"
              autoComplete="name"
            />
          </label>
        )}

        <label className="sm-field" htmlFor={emailId}>
          Email
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
        </label>
        {emailError && (
          <p id={`${emailId}-err`} className="field-error" role="alert">{emailError}</p>
        )}

        {/* The label is a SIBLING here, not a wrapper. PasswordInput renders
            a show/hide <button> inside itself, and accessible-name-from-
            content walks the label's subtree — nesting it makes the field
            announce as "Password Show password", and flip to "Password Hide
            password" as the user toggles it. */}
        <label className="sm-field-label" htmlFor={passwordId}>
          {isForgot ? 'New password' : 'Password'}
        </label>
        <div className="sm-field">
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
        </div>
        {passwordError && (
          <p className="field-error" role="alert">{passwordError}</p>
        )}

        {isForgot && (
          <>
            <label className="sm-field-label" htmlFor={confirmId}>
              Confirm new password
            </label>
            <div className="sm-field">
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
            </div>
            {confirmError && (
              <p className="field-error" role="alert">{confirmError}</p>
            )}
          </>
        )}

        {info && <p className="auth-info" role="status">{info}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}

        <button className="sm-authbtn" type="submit" disabled={submitting || !formValid}>
          {submitLabel}
        </button>

        {showLinkRow && (
          <div className="sm-authlinks">
            {showForgotLink && (
              <button type="button" onClick={() => switchMode('forgot')}>
                Forgot password
              </button>
            )}
            {showBackLink && (
              <button type="button" onClick={() => switchMode('login')}>
                Back to sign in
              </button>
            )}
            {showForgotLink && showSignupLink && <span aria-hidden="true">·</span>}
            {showSignupLink && (
              <button type="button" onClick={() => switchMode(isSignup ? 'login' : 'signup')}>
                {isSignup ? 'Sign in instead' : 'Create an account'}
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
