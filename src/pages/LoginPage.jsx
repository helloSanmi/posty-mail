import { useId, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PasswordInput } from '../components/PasswordInput';
import { Loading } from '../components/Spinner';

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
    requestPasswordReset,
    bootstrapping,
  } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // 'sent' is a terminal state that REPLACES the form, not a banner over it.
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot' | 'sent'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const nameId = useId();

  const allowSignup = !hasUsers || openSignup;
  const activeMode = !hasUsers ? 'signup' : mode;
  const isForgot = activeMode === 'forgot';
  const isSent = activeMode === 'sent';
  const isSignup = activeMode === 'signup';
  const minPasswordLength = isSignup ? 8 : 1;

  const emailError = touched.email && email && !EMAIL_PATTERN.test(email)
    ? 'Enter a valid email address'
    : '';
  const passwordError = touched.password && password.length > 0 && password.length < minPasswordLength
    ? `Password must be at least ${minPasswordLength} characters`
    : '';
  // Forgot mode collects an email and nothing else — the new password is
  // chosen on the reset page, after the link proves the person owns the
  // mailbox.
  const formValid = isForgot
    ? EMAIL_PATTERN.test(email)
    : EMAIL_PATTERN.test(email) && password.length >= minPasswordLength;

  function switchMode(next) {
    setMode(next);
    setError('');
    setInfo('');
    setPassword('');
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
        await requestPasswordReset(email);
        setMode('sent');
        return;
      }
      const authedUser = isSignup
        ? await signup(email, password, name)
        : await login(email, password);
      // Resume a deep-link if there was one, but never drop someone onto a
      // page their role can't use (a stale ?redirect=/admin from a prior
      // session, say) — fall back to Home in that case.
      // Must be a path on THIS site. `redirect` comes out of the address
      // bar, so /login?redirect=https://evil.example is a link anyone can
      // send — and a login page that forwards to it after a successful
      // sign-in is a credible phishing hop, wearing our domain in the part
      // of the URL people actually read. A single leading slash, and not a
      // second one (protocol-relative //evil.example is still off-site).
      const requested = searchParams.get('redirect') || '/';
      let target = (requested.startsWith('/') && !requested.startsWith('//'))
        ? requested
        : '/';
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
        <Loading />
      </div>
    );
  }

  const heading = isSent
    ? 'Check your email'
    : isForgot
      ? 'Reset your password'
      : !hasUsers
        ? 'Create the first admin account'
        : isSignup
          ? 'Create your account'
          : 'Welcome back';

  // The sign-in subheading DID say the heading twice ("Sign in" over "Sign
  // in to your Posty workspace") and deserved to go. The others did not: each
  // is the only on-screen text explaining what the flow will actually do. For
  // reset that now means saying a link is coming — this page used to set a new
  // password on the spot, and the subheading said so, which is exactly the
  // kind of comment-and-copy pair that goes quietly false when the behaviour
  // underneath it changes.
  const subheading = isSent
    ? null
    : isForgot
      ? 'Enter your email and we will send a reset link to the address on file.'
      : !hasUsers
        ? 'This first account becomes the workspace admin.'
        : isSignup
          ? 'Set up a new workspace in a few seconds.'
          : INSTALL_NAME;

  const submitLabel = isForgot
    ? (submitting ? 'Sending…' : 'Send reset link')
    : isSignup
      ? (submitting ? 'Working…' : 'Create account')
      : (submitting ? 'Working…' : 'Sign in');

  // One row of links, not a divider plus a stack. Only two of the three can
  // ever be showing at once (the back-link owns the forgot mode outright),
  // so a single separator between them is all the row needs.
  const showForgotLink = !isForgot && !isSent && hasUsers && passwordResetEnabled;
  const showBackLink = isForgot;
  const showSignupLink = !isForgot && !isSent && allowSignup && hasUsers;
  const showLinkRow = showForgotLink || showBackLink || showSignupLink;

  // Replaces the form rather than sitting above it.
  //
  // The old flow left an editable, pre-filled form under a dismissable banner,
  // which invites a second and third submit — and those burn the same small
  // per-address budget the user will need when the real link arrives.
  //
  // The wording is identical whether or not the account exists, and the
  // address comes from local state (what they typed), never from the server
  // response, which is only { ok: true }. This paragraph is the ONLY place a
  // stuck user can be helped: a dry-run provider, a missing sender, a provider
  // error and a hard bounce all produce exactly this screen, by design.
  if (isSent) {
    return (
      <div className="auth-shell">
        <div className="sm-authcard auth-card surface">
          <div className="sm-authbrand">
            <img src="/posty-mark.svg" alt="Posty" className="auth-logo" />
            <h1>{heading}</h1>
          </div>
          <p className="auth-info" role="status">
            If an account exists for {email}, a reset link is on its way. It
            expires in 60 minutes. If nothing arrives, check your spam folder,
            then ask a workspace admin to set a new password for you from
            Access.
          </p>
          <button className="sm-authbtn" type="button" onClick={() => switchMode('login')}>
            Back to sign in
          </button>
          <div className="sm-authlinks">
            {/* Keeps the address, so correcting a typo is an edit rather than
                a re-type. */}
            <button type="button" onClick={() => setMode('forgot')}>
              Use a different address
            </button>
          </div>
        </div>
      </div>
    );
  }

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

        {/* No password field in forgot mode, at all. Leaving it on screen
            while the request ignored it would be WORSE than the flow it
            replaced: the user would type a password, be told the request
            succeeded, and believe they had set it. */}
        {!isForgot && (
          <>
            {/* The label is a SIBLING here, not a wrapper. PasswordInput
                renders a show/hide <button> inside itself, and accessible-
                name-from-content walks the label's subtree — nesting it makes
                the field announce as "Password Show password", and flip to
                "Password Hide password" as the user toggles it. */}
            <label className="sm-field-label" htmlFor={passwordId}>Password</label>
            <div className="sm-field">
              <PasswordInput
                id={passwordId}
                required
                minLength={minPasswordLength}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                placeholder={isSignup ? 'At least 8 characters' : '••••••••'}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                aria-invalid={Boolean(passwordError)}
              />
            </div>
            {passwordError && (
              <p className="field-error" role="alert">{passwordError}</p>
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
