import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  cleanup, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';

// The forgot-password flow on the login screen.
//
// This page used to collect an email AND a new password, and post both to an
// unauthenticated endpoint that set the password — no token, no email, no
// proof the caller owned the mailbox. These tests exist to stop that coming
// back in any form, including the subtler one: leaving the password fields on
// screen while the request quietly ignores them, which is WORSE, because the
// user then believes they set a password that was never set.

const requestPasswordReset = vi.fn();
const login = vi.fn();
const signup = vi.fn();

let auth;
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => auth,
}));

const BASE = {
  hasUsers: true,
  openSignup: false,
  passwordResetEnabled: true,
  bootstrapping: false,
  login: (...args) => login(...args),
  signup: (...args) => signup(...args),
  requestPasswordReset: (...args) => requestPasswordReset(...args),
};

const mount = (overrides = {}) => {
  auth = { ...BASE, ...overrides };
  return render(<MemoryRouter><LoginPage /></MemoryRouter>);
};

const goToForgot = () => fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));

beforeEach(() => {
  requestPasswordReset.mockReset();
  requestPasswordReset.mockResolvedValue({ ok: true });
  login.mockReset();
  signup.mockReset();
});
afterEach(cleanup);

describe('LoginPage forgot-password flow', () => {
  test('asks for an email and nothing else', () => {
    // The takeover, as it appeared on screen. If a password field is present
    // in this mode at all, something is wrong.
    mount();
    goToForgot();
    const inputs = [...document.querySelectorAll('input')];
    expect(inputs).toHaveLength(1);
    expect(inputs[0].type).toBe('email');
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/confirm/i)).not.toBeInTheDocument();
  });

  test('says a link is coming, rather than promising a password change', () => {
    mount();
    goToForgot();
    expect(screen.getByText(/send a reset link/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });

  test('submits the address alone', async () => {
    mount();
    goToForgot();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sanmi@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledWith('sanmi@example.com'));
    expect(requestPasswordReset).toHaveBeenCalledTimes(1);
    // One argument. A second would mean a password is still being sent.
    expect(requestPasswordReset.mock.calls[0]).toHaveLength(1);
  });

  describe('the confirmation', () => {
    const send = async (email = 'sanmi@example.com') => {
      mount();
      goToForgot();
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
      fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
      await screen.findByText(/reset link is on its way/i);
    };

    test('replaces the form instead of sitting above it', async () => {
      // The old flow left an editable, pre-filled form under a banner, which
      // invites a second and third submit — and those burn the same small
      // per-address budget the user needs when the real link arrives.
      await send();
      expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /send reset link/i })).not.toBeInTheDocument();
    });

    test('reads the same whether or not the account exists', async () => {
      // The server returns { ok: true } either way by design, so this copy is
      // the one thing that must not vary.
      await send('definitely-real@example.com');
      const first = screen.getByRole('status').textContent.replace('definitely-real@example.com', 'ADDRESS');
      cleanup();
      await send('no-such-person@example.com');
      const second = screen.getByRole('status').textContent.replace('no-such-person@example.com', 'ADDRESS');
      expect(second).toBe(first);
    });

    test('tells a stuck user what to do, because every failure looks like this', async () => {
      // A dry-run provider, a missing sender, a provider error and a hard
      // bounce all produce exactly this screen. This paragraph is the only
      // place those people can be helped.
      await send();
      const copy = screen.getByRole('status').textContent;
      expect(copy).toMatch(/60 minutes/);
      expect(copy).toMatch(/spam/i);
      expect(copy).toMatch(/admin/i);
    });

    test('shows the address the user typed, not one from the server', async () => {
      await send('typed-this@example.com');
      expect(screen.getByRole('status')).toHaveTextContent('typed-this@example.com');
    });

    test('lets them correct a typo without retyping the whole address', async () => {
      await send('tpyo@example.com');
      fireEvent.click(screen.getByRole('button', { name: /different address/i }));
      expect(screen.getByLabelText('Email')).toHaveValue('tpyo@example.com');
    });

    test('offers a way back to sign in', async () => {
      await send();
      fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }));
      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    });
  });

  describe('the link is only offered when it can work', () => {
    test('hidden when the server says reset is unavailable', () => {
      mount({ passwordResetEnabled: false });
      expect(screen.queryByRole('button', { name: /forgot password/i })).not.toBeInTheDocument();
    });

    test('shown when it is available', () => {
      mount({ passwordResetEnabled: true });
      expect(screen.getByRole('button', { name: /forgot password/i })).toBeInTheDocument();
    });

    test('hidden on a fresh install with no users yet', () => {
      mount({ hasUsers: false });
      expect(screen.queryByRole('button', { name: /forgot password/i })).not.toBeInTheDocument();
    });
  });

  test('signing in still wants a password', () => {
    // Guards against the forgot-mode edit accidentally removing the field for
    // everyone.
    mount();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });
});
