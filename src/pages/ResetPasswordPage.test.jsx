import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  cleanup, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ResetPasswordPage } from './ResetPasswordPage';

// Redeeming a reset link.
//
// This page is always reached cold, from an email, by someone already locked
// out — so the states that are NOT the happy path are most of the file. The
// two that matter most: a dead link must not say WHY it is dead (that
// confirms a guessed token was once real, and confirms an account exists),
// and an offline browser must not be mistaken for a dead link (that sends the
// user back to their inbox to burn another rate-limited send on a replacement
// they did not need).

const checkResetToken = vi.fn();
const resetPassword = vi.fn();
const endSession = vi.fn();

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ checkResetToken, resetPassword, endSession }),
}));

const TOKEN = 'a'.repeat(43);

// Reports the ROUTER's location into the DOM. MemoryRouter keeps history in
// memory and never writes to window.location, so asserting on
// window.location.pathname would be asserting on '/' — a check that cannot
// fail no matter what the page does with the token.
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="router-location">{location.pathname}{location.search}{location.hash}</span>;
}

const mount = (path = `/reset-password/${TOKEN}`) => render(
  <MemoryRouter initialEntries={[path]}>
    <LocationProbe />
    <Routes>
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/login" element={<p>login screen</p>} />
    </Routes>
  </MemoryRouter>,
);

// An axios-shaped rejection: the interceptor reads error.response, and the
// difference between "has one" and "does not" is the whole offline story.
const httpError = (status, error) => Object.assign(new Error(error || 'failed'), {
  response: { status, data: { error } },
});

beforeEach(() => {
  checkResetToken.mockReset();
  resetPassword.mockReset();
  endSession.mockReset();
});
afterEach(cleanup);

describe('ResetPasswordPage', () => {
  describe('before the form appears', () => {
    test('checks the link once, and shows the form when it is live', async () => {
      checkResetToken.mockResolvedValue({ valid: true });
      mount();
      expect(await screen.findByLabelText('New password')).toBeInTheDocument();
      expect(checkResetToken).toHaveBeenCalledTimes(1);
      expect(checkResetToken).toHaveBeenCalledWith(TOKEN);
    });

    test('a short or malformed token never reaches the network', async () => {
      // Decided entirely client-side, so it discloses nothing — and it spends
      // none of the small shared rate-limit budget on a link the user visibly
      // truncated when copying it out of their mail client.
      mount('/reset-password/abc');
      expect(await screen.findByText(/Reset link incomplete/i)).toBeInTheDocument();
      expect(checkResetToken).not.toHaveBeenCalled();
    });

    test('no token at all is "incomplete", not "invalid"', async () => {
      mount('/reset-password');
      expect(await screen.findByText(/Reset link incomplete/i)).toBeInTheDocument();
      expect(checkResetToken).not.toHaveBeenCalled();
      // And it names a real next action rather than only apologising.
      expect(screen.getByText(/straight from your email/i)).toBeInTheDocument();
    });
  });

  describe('a dead link', () => {
    test('says only that it is dead, and names all three causes', async () => {
      checkResetToken.mockResolvedValue({ valid: false });
      mount();
      expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
      // Expired, used, and superseded must all be named, or someone who
      // clicked "resend" and then opened the FIRST email concludes the whole
      // feature is broken.
      const detail = screen.getByText(/Reset links expire/i).textContent;
      expect(detail).toMatch(/expire/i);
      expect(detail).toMatch(/once/i);
      expect(detail).toMatch(/replaces the old one/i);
    });

    test('offers no password fields — you cannot type into a dead link', async () => {
      checkResetToken.mockResolvedValue({ valid: false });
      mount();
      await screen.findByText(/no longer valid/i);
      expect(document.querySelectorAll('input')).toHaveLength(0);
    });

    test('the page never branches on a reason the server might send', async () => {
      // The server deliberately returns one body for expired, used, unknown
      // and superseded. A page that grew a branch on a reason field would
      // quietly reopen that oracle the day someone added one.
      const source = ResetPasswordPage.toString();
      expect(source).not.toMatch(/\breason\b/);
      expect(source).not.toMatch(/already_used|expired['"]/);
    });
  });

  describe('a connection failure is not a dead link', () => {
    test('shows a retry instead of sending the user back to their inbox', async () => {
      checkResetToken.mockRejectedValueOnce(new Error('Network Error'));
      mount();
      expect(await screen.findByText(/Could not reach the server/i)).toBeInTheDocument();
      expect(screen.queryByText(/no longer valid/i)).not.toBeInTheDocument();
      expect(screen.getByText(/has not been used/i)).toBeInTheDocument();
    });

    test('retrying re-runs the check with the token it already captured', async () => {
      // The token has been stripped from the URL by now, so a reload would
      // lose it — which is why Retry re-fires the call rather than reloading.
      checkResetToken.mockRejectedValueOnce(new Error('Network Error'));
      mount();
      const retry = await screen.findByRole('button', { name: /try again/i });
      checkResetToken.mockResolvedValueOnce({ valid: true });
      fireEvent.click(retry);
      expect(await screen.findByLabelText('New password')).toBeInTheDocument();
      expect(checkResetToken).toHaveBeenLastCalledWith(TOKEN);
    });

    test('a 429 does not tell the user their live link is dead', async () => {
      // The check shares authLimiter with login, signup and forgot-password,
      // so on a self-hosted box behind one NAT this is the likely failure,
      // not an exotic one. Calling it a dead link would send someone with a
      // perfectly good token back to burn another rate-limited send.
      checkResetToken.mockRejectedValueOnce(httpError(429, 'Too many auth attempts. Try again later.'));
      mount();
      expect(await screen.findByText(/Could not reach the server/i)).toBeInTheDocument();
      expect(screen.queryByText(/no longer valid/i)).not.toBeInTheDocument();
      expect(screen.getByText(/has not been used/i)).toBeInTheDocument();
    });

    test('a 500 is inconclusive too, not a verdict on the link', async () => {
      checkResetToken.mockRejectedValueOnce(httpError(500, 'boom'));
      mount();
      expect(await screen.findByText(/Could not reach the server/i)).toBeInTheDocument();
      expect(screen.queryByText(/no longer valid/i)).not.toBeInTheDocument();
    });

    test('only an explicit valid:false is treated as a dead link', async () => {
      // The one unambiguous answer. Everything else fails soft.
      checkResetToken.mockResolvedValue({ valid: false });
      mount();
      expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
    });

    test('a disabled server says so, rather than blaming the link', async () => {
      checkResetToken.mockRejectedValueOnce(httpError(403, 'disabled'));
      mount();
      expect(await screen.findByText(/unavailable/i)).toBeInTheDocument();
      expect(screen.getByText(/ask a workspace admin/i)).toBeInTheDocument();
    });
  });

  describe('the form', () => {
    beforeEach(() => { checkResetToken.mockResolvedValue({ valid: true }); });

    test('both fields are new-password, and nothing is current-password', async () => {
      // current-password on the confirm field makes a manager fill the OLD
      // password there, and the form can then never validate.
      mount();
      await screen.findByLabelText('New password');
      const inputs = [...document.querySelectorAll('input')];
      expect(inputs).toHaveLength(2);
      inputs.forEach((input) => expect(input.getAttribute('autocomplete')).toBe('new-password'));
    });

    test('the fields announce their own names, not the show/hide button', async () => {
      // PasswordInput renders a toggle button inside itself, so a wrapping
      // label would make the field announce as "New password Show password"
      // and flip as the toggle is pressed. The label is a sibling instead.
      mount();
      const field = await screen.findByLabelText('New password');
      expect(field.tagName).toBe('INPUT');
      expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument();
    });

    test('submit stays disabled until both match and are long enough', async () => {
      mount();
      const password = await screen.findByLabelText('New password');
      const confirm = screen.getByLabelText('Confirm new password');
      const submit = screen.getByRole('button', { name: /set new password/i });

      expect(submit).toBeDisabled();
      fireEvent.change(password, { target: { value: 'short' } });
      fireEvent.change(confirm, { target: { value: 'short' } });
      expect(submit).toBeDisabled();

      fireEvent.change(password, { target: { value: 'long-enough-1' } });
      fireEvent.change(confirm, { target: { value: 'different-one' } });
      expect(submit).toBeDisabled();

      fireEvent.change(confirm, { target: { value: 'long-enough-1' } });
      expect(submit).toBeEnabled();
    });

    test('the mismatch appears on blur, not on every keystroke', async () => {
      // The message carries role="alert", so announcing it per character
      // interrupts a screen reader on every letter typed.
      mount();
      const password = await screen.findByLabelText('New password');
      const confirm = screen.getByLabelText('Confirm new password');
      fireEvent.change(password, { target: { value: 'long-enough-1' } });
      fireEvent.change(confirm, { target: { value: 'l' } });
      expect(screen.queryByText(/do not match/i)).not.toBeInTheDocument();
      fireEvent.blur(confirm);
      expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    });

    test('an error names the field it belongs to, for a screen reader too', async () => {
      mount();
      const confirm = await screen.findByLabelText('Confirm new password');
      const password = screen.getByLabelText('New password');
      fireEvent.change(password, { target: { value: 'long-enough-1' } });
      fireEvent.change(confirm, { target: { value: 'nope' } });
      fireEvent.blur(confirm);

      expect(confirm).toHaveAttribute('aria-invalid', 'true');
      const describedBy = confirm.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy)).toHaveTextContent(/do not match/i);
    });

    test('sends the token in the call, and signs the browser out on success', async () => {
      resetPassword.mockResolvedValue({ ok: true });
      mount();
      const password = await screen.findByLabelText('New password');
      fireEvent.change(password, { target: { value: 'brand-new-password' } });
      fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'brand-new-password' } });
      fireEvent.click(screen.getByRole('button', { name: /set new password/i }));

      await waitFor(() => expect(screen.getByText(/Password changed/i)).toBeInTheDocument());
      expect(resetPassword).toHaveBeenCalledWith(TOKEN, 'brand-new-password');
      // The server bumped tokenVersion, so a token still sitting in this
      // browser is already dead. Clearing it saves a pointless 401.
      expect(endSession).toHaveBeenCalled();
      expect(screen.getByText(/signed out on every device/i)).toBeInTheDocument();
    });

    test('never stores a token, even if the server sent one', async () => {
      resetPassword.mockResolvedValue({ ok: true, token: 'should-be-ignored' });
      mount();
      fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'brand-new-password' } });
      fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'brand-new-password' } });
      fireEvent.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => expect(screen.getByText(/Password changed/i)).toBeInTheDocument());

      expect(window.localStorage.getItem('campaign-suite-token')).toBeNull();
      expect(JSON.stringify(window.sessionStorage)).not.toContain(TOKEN);
      expect(JSON.stringify(window.localStorage)).not.toContain(TOKEN);
    });

    test('offers a way to sign in rather than redirecting on a timer', async () => {
      resetPassword.mockResolvedValue({ ok: true });
      mount();
      fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'brand-new-password' } });
      fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'brand-new-password' } });
      fireEvent.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => expect(screen.getByText(/Password changed/i)).toBeInTheDocument());
      expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
    });

    test('a submit-time failure keeps what was typed', async () => {
      resetPassword.mockRejectedValueOnce(new Error('Network Error'));
      mount();
      const password = await screen.findByLabelText('New password');
      const confirm = screen.getByLabelText('Confirm new password');
      fireEvent.change(password, { target: { value: 'brand-new-password' } });
      fireEvent.change(confirm, { target: { value: 'brand-new-password' } });
      fireEvent.click(screen.getByRole('button', { name: /set new password/i }));

      await waitFor(() => expect(screen.getByText(/Check your connection/i)).toBeInTheDocument());
      expect(password).toHaveValue('brand-new-password');
      expect(confirm).toHaveValue('brand-new-password');
      // Still on the form: a connection blip must not read as a dead link.
      expect(screen.queryByText(/no longer valid/i)).not.toBeInTheDocument();
    });

    test('a link that died between the check and the submit is reported inline', async () => {
      // The check is advisory. A token valid at mount can be spent a minute
      // later by the same link opened in a second tab.
      resetPassword.mockRejectedValueOnce(httpError(400, 'This reset link is no longer valid. Request a new one.'));
      mount();
      fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'brand-new-password' } });
      fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'brand-new-password' } });
      fireEvent.click(screen.getByRole('button', { name: /set new password/i }));
      await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeInTheDocument());
    });
  });

  describe('the token leaves the address bar', () => {
    test('the URL no longer carries it once the page has it', async () => {
      checkResetToken.mockResolvedValue({ valid: true });
      mount();
      await screen.findByLabelText('New password');
      // The page navigates to the tokenless path with replace, so history
      // holds no entry the Back button could use to put it back on screen.
      const location = screen.getByTestId('router-location');
      expect(location).toHaveTextContent('/reset-password');
      expect(location.textContent).not.toContain(TOKEN);
      // And the form is still usable afterwards — the strip must not take the
      // token away from the component along with the URL.
      expect(screen.getByLabelText('New password')).toBeInTheDocument();
    });

    test('it is never written to storage', async () => {
      checkResetToken.mockResolvedValue({ valid: true });
      mount();
      await screen.findByLabelText('New password');
      expect(JSON.stringify(window.localStorage)).not.toContain(TOKEN);
      expect(JSON.stringify(window.sessionStorage)).not.toContain(TOKEN);
    });
  });
});
