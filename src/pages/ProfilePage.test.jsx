import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  cleanup, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { ProfilePage } from './ProfilePage';

// Self-service profile, as a page that is READ first and edited on purpose.
//
// The first version had every field permanently editable with the three
// password boxes open underneath. The tests below therefore start with what
// is NOT on screen: a page you came to look at should not look like a form,
// and "change my password" should be something you choose, not something you
// can wander into.
//
// The server guards what must not be writable; this file covers the half it
// cannot check — whether the panels tell the truth, and whether a failure in
// one destroys work in the other.

const updateProfile = vi.fn(async (payload) => ({
  user: { ...EDITOR, ...payload },
}));
const changeOwnPassword = vi.fn(async () => ({ token: 'fresh-token', ok: true }));

vi.mock('../services/authApi', () => ({
  updateProfile: (...args) => updateProfile(...args),
  changeOwnPassword: (...args) => changeOwnPassword(...args),
}));
vi.mock('../services/apiClient', () => ({ setAuthHeader: vi.fn() }));

const EDITOR = {
  email: 'sanmi@example.com',
  name: 'Sanmi Idowu',
  location: '',
  role: 'editor',
  permissions: { v: 2, areas: { contacts: 'write', campaigns: 'manage' } },
};

const applyUser = vi.fn();
const notify = vi.fn();
let currentUser = EDITOR;

// The page reads the signed-in user from context rather than from props, so
// the context is what the test supplies.
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, applyUser }),
}));

const mount = (user = EDITOR) => {
  currentUser = user;
  return render(<ProfilePage notify={notify} />);
};

const field = (label) => screen.getByLabelText(new RegExp(label, 'i'));
const openEdit = () => fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
const openPassword = () => fireEvent.click(screen.getByRole('button', { name: /Change$/ }));

afterEach(() => {
  cleanup();
  currentUser = EDITOR;
  [updateProfile, changeOwnPassword, applyUser, notify].forEach((fn) => fn.mockClear());
});

describe('the page itself', () => {
  test('opens with nothing to fill in', () => {
    // The complaint that caused this redesign. A profile is somewhere you
    // arrive to look at yourself; presenting it as an open form — password
    // boxes included — asks a question nobody came to answer.
    mount();
    expect(document.querySelectorAll('input')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('shows the details as text, with one action each', () => {
    mount();
    // Twice on purpose: once as the identity beside the avatar, once as the
    // Name row. Both are the answer to a different question.
    expect(screen.getAllByText('Sanmi Idowu').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Change$/ })).toBeInTheDocument();
  });

  test('an unset location says so rather than showing a gap', () => {
    mount({ ...EDITOR, location: '' });
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0);
  });

  test('says when the password was last changed, and admits when it cannot', () => {
    // "Not changed yet" is the honest answer for someone still on the
    // password an admin set for them — which is exactly who should be
    // nudged. Inventing a date from createdAt would look identical and be
    // a fabrication.
    mount();
    expect(screen.getByText('Not changed yet')).toBeInTheDocument();

    cleanup();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    mount({ ...EDITOR, passwordChangedAt: yesterday });
    expect(screen.getByText('Changed yesterday')).toBeInTheDocument();
  });

  test('an old change falls back to a date rather than counting days', () => {
    const longAgo = new Date(Date.now() - 200 * 86400000).toISOString();
    mount({ ...EDITOR, passwordChangedAt: longAgo });
    expect(screen.getByText(/^Changed \w+ \d+, \d{4}$/)).toBeInTheDocument();
  });

  test('a corrupt timestamp does not render Invalid Date', () => {
    mount({ ...EDITOR, passwordChangedAt: 'not-a-date' });
    expect(screen.getByText('Not changed yet')).toBeInTheDocument();
  });

  test('the password panel only exists once asked for', () => {
    mount();
    expect(screen.queryByLabelText(/Current password/i)).toBeNull();
    openPassword();
    expect(screen.getByLabelText(/Current password/i)).toBeInTheDocument();
  });
});

describe('name and location', () => {
  test('Save is off until something actually changes', () => {
    // A permanently enabled Save on an unchanged form invites a pointless
    // write, and makes "did that save?" unanswerable by looking.
    mount();
    openEdit();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(field('^Name'), { target: { value: 'Sanmi I.' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  test('saves both fields and hands the updated user back up', async () => {
    // Into the auth context, or the topbar keeps showing the old name
    // until a reload.
    mount();
    openEdit();
    fireEvent.change(field('^Name'), { target: { value: 'Sanmi I.' } });
    fireEvent.change(field('Location'), { target: { value: 'Lagos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({
      name: 'Sanmi I.', location: 'Lagos',
    }));
    await waitFor(() => expect(applyUser).toHaveBeenCalled());
    expect(applyUser.mock.calls[0][0].location).toBe('Lagos');
  });

  test('clearing a location sends the empty string, not nothing', async () => {
    // "Remove my location" has to be expressible. If an empty value were
    // dropped from the payload, a location would be permanent once set.
    mount({ ...EDITOR, location: 'Lagos' });
    openEdit();
    fireEvent.change(field('Location'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({
      name: 'Sanmi Idowu', location: '',
    }));
  });

  test('location is marked optional in the panel', () => {
    mount();
    openEdit();
    expect(screen.getByText('optional')).toBeInTheDocument();
  });

  test('says who controls email and role, rather than just omitting them', () => {
    // Someone hunting for a field that is not there concludes the app is
    // unfinished. Naming the reason costs one line.
    mount();
    expect(screen.getByText(/set by an admin/i)).toBeInTheDocument();
    expect(screen.getByText('sanmi@example.com')).toBeInTheDocument();
  });

  test('a failed save does not clear what was typed', async () => {
    updateProfile.mockRejectedValueOnce({ response: { data: { error: 'Nope' } } });
    mount();
    openEdit();
    fireEvent.change(field('^Name'), { target: { value: 'Sanmi I.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Nope', 'error'));
    expect(field('^Name')).toHaveValue('Sanmi I.');
  });
});

describe('changing your own password', () => {
  function fill({ cur = 'old-password-1', next = 'new-password-1', confirm = 'new-password-1' } = {}) {
    fireEvent.change(field('^Current password'), { target: { value: cur } });
    fireEvent.change(field('^New password'), { target: { value: next } });
    fireEvent.change(field('^Confirm new password'), { target: { value: confirm } });
  }

  test('needs the current password — the button stays off without it', () => {
    // Not politeness. Without it, a leaked session becomes a permanent
    // takeover: whoever holds it sets a new password and locks the owner out.
    mount();
    openPassword();
    fireEvent.change(field('^New password'), { target: { value: 'new-password-1' } });
    fireEvent.change(field('^Confirm new password'), { target: { value: 'new-password-1' } });
    expect(screen.getByRole('button', { name: /^Change password$/ })).toBeDisabled();
  });

  test('refuses a new password under 8 characters', () => {
    mount();
    openPassword();
    fill({ next: 'short', confirm: 'short' });
    expect(screen.getByRole('button', { name: /^Change password$/ })).toBeDisabled();
  });

  test('says so when the two do not match, before submitting', () => {
    // The server compares a hash and only ever sees one of them, so it
    // cannot give this answer at all.
    mount();
    openPassword();
    fill({ confirm: 'different-password-1' });
    expect(screen.getByText('These do not match.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Change password$/ })).toBeDisabled();
  });

  test('submits both passwords and closes the panel on success', async () => {
    // Closing IS how the fields are cleared — the panel unmounts, so there
    // is nothing left holding a typed password in memory or on screen.
    mount();
    openPassword();
    fill();
    fireEvent.click(screen.getByRole('button', { name: /^Change password$/ }));
    await waitFor(() => expect(changeOwnPassword)
      .toHaveBeenCalledWith('old-password-1', 'new-password-1', false));
    await waitFor(() => expect(screen.queryByLabelText(/Current password/i)).toBeNull());
    expect(notify).toHaveBeenCalledWith('Password changed');
  });

  test('a wrong current password is shown IN the form, not as a toast', async () => {
    // A toast disappears and takes the reason with it, while the person is
    // still looking at the field that caused it.
    changeOwnPassword.mockRejectedValueOnce({
      response: { data: { error: 'Your current password is not correct.' } },
    });
    mount();
    openPassword();
    fill();
    fireEvent.click(screen.getByRole('button', { name: /^Change password$/ }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('current password is not correct');
    });
  });

  test('a failed password change never touches the details', async () => {
    // The reason these are two panels rather than one long form: a wrong
    // current password must not be able to discard a name edit.
    changeOwnPassword.mockRejectedValueOnce({ response: { data: { error: 'Nope' } } });
    mount();
    openPassword();
    fill();
    fireEvent.click(screen.getByRole('button', { name: /^Change password$/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(updateProfile).not.toHaveBeenCalled();
    expect(applyUser).not.toHaveBeenCalled();
  });

  test('offers to sign out the other devices, rather than disclaiming it', async () => {
    // The panel used to state that other devices stayed signed in — which
    // tells someone worried about a compromise exactly the thing they do not
    // want to hear, and gives them nowhere to go with it. It is an action now.
    mount();
    openPassword();
    expect(screen.getByLabelText(/Sign out my other devices/i)).toBeInTheDocument();
  });

  test('the sign-out choice reaches the request', async () => {
    mount();
    openPassword();
    fireEvent.click(screen.getByLabelText(/Sign out my other devices/i));
    fill();
    fireEvent.click(screen.getByRole('button', { name: /^Change password$/ }));
    await waitFor(() => expect(changeOwnPassword)
      .toHaveBeenCalledWith('old-password-1', 'new-password-1', true));
  });

  test('and defaults to OFF, so a routine change does not log you out everywhere', async () => {
    mount();
    openPassword();
    fill();
    fireEvent.click(screen.getByRole('button', { name: /^Change password$/ }));
    await waitFor(() => expect(changeOwnPassword)
      .toHaveBeenCalledWith('old-password-1', 'new-password-1', false));
  });
});

describe('what your role can reach', () => {
  test('lists granted areas with the level in words', () => {
    mount();
    expect(screen.getByText('Audience')).toBeInTheDocument();
    expect(screen.getByText('View and edit')).toBeInTheDocument();
    expect(screen.getByText('Full access')).toBeInTheDocument();
  });

  test('counts implied access, because the sidebar does', () => {
    // A campaigns role reads Audience and Email whether or not anyone ticked
    // them. Omitting those would contradict what the person can plainly see.
    mount({ ...EDITOR, permissions: { v: 2, areas: { campaigns: 'write' } } });
    expect(screen.getByText('Audience')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  test('omits what the role does not hold', () => {
    mount();
    expect(screen.queryByText('Connections')).toBeNull();
  });
});
