import {
  useCallback, useEffect, useId, useRef, useState,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PasswordInput } from '../components/PasswordInput';
import { Loading } from '../components/Spinner';

// Redeeming a reset link. Reached cold from an email, always signed out.
//
// Kept in step with RESET_TOKEN_TTL_MINUTES in backend/lib/passwordReset.js —
// there is no import across that boundary, so a test greps both. Copy that
// contradicts behaviour is indistinguishable from a broken feature.
const TTL_MINUTES = 60;

// Deliberately looser than the server's exact 43 characters, so a future
// encoding change does not silently break this whole page before anyone
// notices. This is not validation — the server validates — it is a courtesy
// that avoids spending one of a small number of rate-limited requests on a
// link the user visibly truncated when they copied it out of their mail
// client.
const PLAUSIBLE_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

const DEAD_LINK_HEADING = 'This reset link is no longer valid.';
// All three causes are named. A user who clicked "resend" and then opened the
// FIRST email would otherwise conclude the feature is broken.
const DEAD_LINK_DETAIL = `Reset links expire after ${TTL_MINUTES} minutes, can only be used once, and requesting a new one replaces the old one.`;

export function ResetPasswordPage() {
  const { checkResetToken, resetPassword, endSession } = useAuth();
  const { token: tokenFromUrl } = useParams();
  const navigate = useNavigate();

  // Captured once, at first render, and read from here forever after. The
  // effect below strips it from the address bar immediately.
  const [token] = useState(() => tokenFromUrl || '');

  // 'checking' | 'form' | 'invalid' | 'missing' | 'network' | 'disabled' | 'success'
  const [stage, setStage] = useState(() => (
    PLAUSIBLE_TOKEN.test(tokenFromUrl || '') ? 'checking' : 'missing'
  ));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState({ password: false, confirm: false });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const passwordId = useId();
  const confirmId = useId();
  const passwordRef = useRef(null);
  const headingRef = useRef(null);

  // Take the token out of the address bar as soon as we have it in state.
  //
  // `replace` is load-bearing: it drops the tokenised entry from history, so
  // pressing Back after a successful reset cannot put the credential back on
  // screen or into a screenshot. The accepted cost is that F5 loses the token,
  // which is why the 'missing' state names a real next action rather than just
  // apologising.
  //
  // The token is NEVER written to localStorage or sessionStorage. Persisting
  // it would undo everything this line buys and outlive the tab.
  useEffect(() => {
    if (tokenFromUrl) navigate('/reset-password', { replace: true });
  }, [tokenFromUrl, navigate]);

  const runCheck = useCallback(() => {
    let cancelled = false;
    setStage('checking');
    checkResetToken(token)
      .then((result) => {
        if (cancelled) return;
        setStage(result?.valid ? 'form' : 'invalid');
      })
      .catch((requestError) => {
        if (cancelled) return;
        const status = requestError.response?.status;
        if (status === 403) {
          setStage('disabled');
          return;
        }
        // The check is ADVISORY, so an ambiguous answer must fail soft — never
        // to the most destructive state.
        //
        // Only a 200 carrying { valid: false } actually means the link is
        // dead, and that is handled above. Everything reaching here is an
        // inconclusive answer: no response at all (an offline browser), a 429
        // from the limiter this endpoint SHARES with login and signup, or a
        // 5xx. Rendering those as "your link is dead" tells someone holding a
        // perfectly good token to go back to their inbox and burn another
        // rate-limited send on a replacement they never needed — and on a
        // self-hosted box behind one NAT, the 429 is the likely case, not the
        // exotic one.
        //
        // The 'network' copy is already right for all of them: it says the
        // link has NOT been used and offers a retry.
        setStage('network');
      });
    return () => { cancelled = true; };
  }, [checkResetToken, token]);

  // Fires once. Never auto-retries: the check is advisory, and a retry loop on
  // a rate-limited endpoint is how a user ends up locked out of their own
  // recovery.
  useEffect(() => {
    if (stage !== 'checking') return undefined;
    return runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus the first field once it actually exists.
  //
  // NOT autoFocus: that fires at mount, when the input is not rendered because
  // the check is still in flight, so focus never lands and the page reads as
  // inert. GlobalSearch and GroupsPanel already use ref-plus-effect for the
  // same reason.
  useEffect(() => {
    if (stage === 'form') passwordRef.current?.focus();
  }, [stage]);

  // Any terminal state swaps the whole body out, so the control that had focus
  // unmounts and focus falls to <body> — a screen-reader user hears nothing
  // and a keyboard user's next Tab restarts at the top of the document.
  // Moving it to the heading is enough; deliberately no role="alert" as well
  // (that would announce twice) and no focus trap, because this is a page and
  // not a Modal.
  useEffect(() => {
    if (stage === 'invalid' || stage === 'success' || stage === 'missing'
      || stage === 'network' || stage === 'disabled') {
      headingRef.current?.focus();
    }
  }, [stage]);

  const weak = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const passwordError = touched.password && weak
    ? 'Password must be at least 8 characters'
    : '';
  // On blur, not on every keystroke. LoginPage has no touched gate here, so it
  // flashes the mismatch on every character typed — and because the message
  // carries role="alert", it interrupts a screen reader each time.
  const confirmError = touched.confirm && mismatch ? 'Passwords do not match' : '';
  const canSubmit = password.length >= 8 && confirm === password && !submitting;

  async function handleSubmit(event) {
    event.preventDefault();
    setTouched({ password: true, confirm: true });
    setError('');
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      // The server bumped tokenVersion, so any token this browser is still
      // holding in localStorage is already dead server-side. Left in place it
      // costs a pointless 401 round trip on the next page load. endSession is
      // the one function that clears the token, the user and the persisted
      // view state, and it is a no-op when already signed out.
      endSession();
      setPassword('');
      setConfirm('');
      setStage('success');
    } catch (requestError) {
      if (requestError.response?.status === 403) {
        setStage('disabled');
        return;
      }
      if (!requestError.response) {
        // Network failure on submit keeps both typed values so the retry is
        // one click, not a re-type.
        setError('Could not reach the server. Check your connection and try again.');
        return;
      }
      setError(requestError.response?.data?.error || 'Could not reset your password.');
    } finally {
      setSubmitting(false);
    }
  }

  // Every state shows the brand block. Someone who clicks a link in an email
  // and lands on an unbranded error page cannot tell whether the page is fake
  // or the email was.
  function shell(heading, subheading, body) {
    return (
      <div className="auth-shell">
        <div className="sm-authcard auth-card surface">
          <div className="sm-authbrand">
            <img src="/posty-mark.svg" alt="Posty" className="auth-logo" />
            <h1 ref={headingRef} tabIndex={-1}>{heading}</h1>
            {subheading && <span className="sm-dim">{subheading}</span>}
          </div>
          {body}
        </div>
      </div>
    );
  }

  if (stage === 'checking') {
    return (
      <div className="auth-shell">
        <Loading />
      </div>
    );
  }

  if (stage === 'missing') {
    return shell(
      'Reset link incomplete',
      'The link did not carry a reset code.',
      <>
        <p className="auth-info" role="status">
          This usually means the link wrapped onto two lines in your email, or
          the page was reloaded after opening it. Open the original link again
          straight from your email, or request a new one.
        </p>
        <Link className="sm-authbtn" to="/login">Back to sign in</Link>
      </>,
    );
  }

  if (stage === 'network') {
    return shell(
      'Could not reach the server',
      'Your reset link has not been used.',
      <>
        <p className="auth-error" role="alert">
          We could not check your link. This is a connection problem, not a
          problem with the link itself.
        </p>
        {/* Retry re-fires the check. It deliberately does NOT reload the page,
            which would lose the token we just stripped from the URL. */}
        <button className="sm-authbtn" type="button" onClick={runCheck}>
          Try again
        </button>
        <div className="sm-authlinks">
          <Link to="/login">Back to sign in</Link>
        </div>
      </>,
    );
  }

  if (stage === 'disabled') {
    return shell(
      'Password reset is unavailable',
      'This server does not have password reset switched on.',
      <>
        <p className="auth-info" role="status">
          Ask a workspace admin to set a new password for you from Access.
        </p>
        <Link className="sm-authbtn" to="/login">Back to sign in</Link>
      </>,
    );
  }

  if (stage === 'invalid') {
    return shell(
      DEAD_LINK_HEADING,
      null,
      <>
        <p className="auth-error" role="alert">{DEAD_LINK_DETAIL}</p>
        <Link className="sm-authbtn" to="/login">Back to sign in</Link>
      </>,
    );
  }

  if (stage === 'success') {
    return shell(
      'Password changed',
      null,
      <>
        <p className="auth-info" role="status">
          Your password has been changed. You have been signed out on every
          device — sign in again with your new password.
        </p>
        <Link className="sm-authbtn" to="/login">Sign in</Link>
      </>,
    );
  }

  return (
    <div className="auth-shell">
      <form className="sm-authcard auth-card surface" onSubmit={handleSubmit} noValidate>
        <div className="sm-authbrand">
          <img src="/posty-mark.svg" alt="Posty" className="auth-logo" />
          <h1 ref={headingRef} tabIndex={-1}>Choose a new password</h1>
          <span className="sm-dim">
            You will be signed out everywhere once it is set.
          </span>
        </div>

        {/* The label is a SIBLING, never a wrapper. PasswordInput renders its
            own show/hide <button>, and accessible-name-from-content walks a
            label's subtree — nesting makes the field announce as "New password
            Show password", flipping as the toggle is pressed. */}
        <label className="sm-field-label" htmlFor={passwordId}>New password</label>
        <div className="sm-field">
          <PasswordInput
            id={passwordId}
            ref={passwordRef}
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
            placeholder="At least 8 characters"
            // new-password on BOTH fields. current-password on the confirm
            // field makes a password manager fill the OLD password there, and
            // the form can then never validate. No hidden username field: this
            // page does not know whose account the link belongs to and must
            // not disclose it — the cost is that some managers save the
            // credential with no username attached.
            autoComplete="new-password"
            aria-invalid={Boolean(passwordError)}
            aria-describedby={passwordError ? `${passwordId}-err` : undefined}
          />
        </div>
        {passwordError && (
          <p id={`${passwordId}-err`} className="field-error" role="alert">{passwordError}</p>
        )}

        <label className="sm-field-label" htmlFor={confirmId}>Confirm new password</label>
        <div className="sm-field">
          <PasswordInput
            id={confirmId}
            required
            minLength={8}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, confirm: true }))}
            placeholder="Type the new password again"
            autoComplete="new-password"
            aria-invalid={Boolean(confirmError)}
            aria-describedby={confirmError ? `${confirmId}-err` : undefined}
          />
        </div>
        {confirmError && (
          <p id={`${confirmId}-err`} className="field-error" role="alert">{confirmError}</p>
        )}

        {error && <p className="auth-error" role="alert">{error}</p>}

        <button className="sm-authbtn" type="submit" disabled={!canSubmit}>
          {submitting ? 'Saving…' : 'Set new password'}
        </button>

        <div className="sm-authlinks">
          <Link to="/login">Back to sign in</Link>
        </div>
      </form>
    </div>
  );
}
