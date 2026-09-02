// SendingCard drives the "can this install send, and as whom?" verdict.
// These are the SetupStatusCard tests, moved when that card and SenderCard
// merged into one group of rows — they still assert the distinction the old
// card missed (key SET vs key VALID), plus the two things the merge added:
// the sender shown from the live sender setting, and remediation hints that
// appear only when something is wrong.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../../services/brevoApi', () => ({
  getSetupStatus: vi.fn(),
  getSenderSetting: vi.fn(),
  getVerifiedSenders: vi.fn(),
  saveSenderSetting: vi.fn(),
}));

import {
  getSenderSetting,
  getSetupStatus,
  getVerifiedSenders,
} from '../../services/brevoApi';
import { SendingCard } from './SendingCard';

const HEALTHY = {
  provider: {
    configured: true, dryRun: false, valid: true, account: 'me@example.com', plan: 'free', error: null,
  },
  sender: { configured: true, email: 'from@example.com', name: 'Me', verified: true },
  webhook: { configured: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  // The sender row prefers the live sender setting; default it to the same
  // address the status reports so tests that don't care can ignore it.
  getSenderSetting.mockResolvedValue({
    effective: { email: 'from@example.com', name: 'Me' },
    stored: { email: 'from@example.com', name: 'Me' },
    source: 'database',
  });
  getVerifiedSenders.mockResolvedValue({ senders: [] });
});

describe('SendingCard', () => {
  it('shows "Ready to send" when the key is valid and the sender is verified', async () => {
    getSetupStatus.mockResolvedValue(HEALTHY);
    render(<SendingCard notify={() => {}} />);
    expect(await screen.findByText('Ready to send')).toBeInTheDocument();
    expect(screen.getByText(/from@example.com/)).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('shows "Action needed" and the shell-override hint when the key is rejected', async () => {
    getSetupStatus.mockResolvedValue({
      ...HEALTHY,
      provider: {
        configured: true,
        dryRun: false,
        valid: false,
        account: null,
        plan: null,
        error: 'Email provider rejected the API key (Key not found). Check BREVO_API_KEY.',
      },
      sender: { configured: true, email: 'from@example.com', name: 'Me', verified: null },
    });
    render(<SendingCard notify={() => {}} />);
    expect(await screen.findByText('Action needed')).toBeInTheDocument();
    expect(screen.getByText('Key rejected')).toBeInTheDocument();
    // The actionable hint about the shell overriding .env must survive the
    // redesign — it is the one piece of prose worth keeping on this row.
    expect(screen.getByText(/unset BREVO_API_KEY/)).toBeInTheDocument();
  });

  it('warns (Check setup) when the sender is not verified', async () => {
    getSetupStatus.mockResolvedValue({
      ...HEALTHY,
      sender: { configured: true, email: 'from@example.com', name: 'Me', verified: false },
      webhook: { configured: true },
    });
    render(<SendingCard notify={() => {}} />);
    expect(await screen.findByText('Check setup')).toBeInTheDocument();
    expect(screen.getByText('Not verified')).toBeInTheDocument();
  });

  it('surfaces dry-run when there is no API key', async () => {
    getSetupStatus.mockResolvedValue({
      provider: {
        configured: false, dryRun: true, valid: false, account: null, plan: null, error: null,
      },
      sender: { configured: false, email: null, name: null, verified: null },
      webhook: { configured: false },
    });
    getSenderSetting.mockResolvedValue({ effective: null, stored: null, source: 'unset' });
    render(<SendingCard notify={() => {}} />);
    await waitFor(() => expect(screen.getByText('Dry-run')).toBeInTheDocument());
    expect(screen.getByText(/emails are logged, not delivered/)).toBeInTheDocument();
  });

  it('keeps the happy path free of remediation prose', async () => {
    getSetupStatus.mockResolvedValue(HEALTHY);
    render(<SendingCard notify={() => {}} />);
    await screen.findByText('Ready to send');
    // Hints are the thing that made the old card wordy. On a fully healthy
    // install there should be none.
    expect(document.querySelectorAll('.setting-row-hint')).toHaveLength(0);
  });

  it('prefers the live sender setting over the status payload', async () => {
    // A sender saved a moment ago should show immediately, before the
    // setup-status round trip catches up.
    getSetupStatus.mockResolvedValue(HEALTHY);
    getSenderSetting.mockResolvedValue({
      effective: { email: 'new@example.com', name: 'Fresh' },
      stored: { email: 'new@example.com', name: 'Fresh' },
      source: 'database',
    });
    render(<SendingCard notify={() => {}} />);
    expect(await screen.findByText('Fresh <new@example.com>')).toBeInTheDocument();
  });
});
