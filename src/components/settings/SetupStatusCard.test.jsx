// SetupStatusCard drives the "can this install send?" verdict. These tests
// mock the API and assert the card renders the right rows + overall verdict —
// the distinction the old card missed (key SET vs key VALID).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock the API module the card imports.
vi.mock('../../services/brevoApi', () => ({
  getSetupStatus: vi.fn(),
}));

import { getSetupStatus } from '../../services/brevoApi';
import { SetupStatusCard } from './SetupStatusCard';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SetupStatusCard', () => {
  it('shows "Ready to send" when the key is valid and the sender is verified', async () => {
    getSetupStatus.mockResolvedValue({
      provider: { configured: true, dryRun: false, valid: true, account: 'me@example.com', plan: 'free', error: null },
      sender: { configured: true, email: 'from@example.com', name: 'Me', verified: true },
      webhook: { configured: false },
    });
    render(<SetupStatusCard />);
    expect(await screen.findByText('Ready to send')).toBeInTheDocument();
    expect(screen.getByText(/from@example.com/)).toBeInTheDocument();
  });

  it('shows "Action needed" and the shell-override hint when the key is rejected', async () => {
    getSetupStatus.mockResolvedValue({
      provider: {
        configured: true, dryRun: false, valid: false, account: null, plan: null,
        error: 'Email provider rejected the API key (Key not found). Check BREVO_API_KEY.',
      },
      sender: { configured: true, email: 'from@example.com', name: 'Me', verified: null },
      webhook: { configured: false },
    });
    render(<SetupStatusCard />);
    expect(await screen.findByText('Action needed')).toBeInTheDocument();
    expect(screen.getByText(/Key rejected/)).toBeInTheDocument();
    // The actionable hint about the shell overriding .env must be surfaced.
    expect(screen.getByText(/unset BREVO_API_KEY/)).toBeInTheDocument();
  });

  it('warns (Check setup) when the sender is not verified', async () => {
    getSetupStatus.mockResolvedValue({
      provider: { configured: true, dryRun: false, valid: true, account: 'me@example.com', plan: 'free', error: null },
      sender: { configured: true, email: 'from@example.com', name: 'Me', verified: false },
      webhook: { configured: true },
    });
    render(<SetupStatusCard />);
    expect(await screen.findByText('Check setup')).toBeInTheDocument();
    expect(screen.getByText(/Not verified/)).toBeInTheDocument();
  });

  it('surfaces dry-run when there is no API key', async () => {
    getSetupStatus.mockResolvedValue({
      provider: { configured: false, dryRun: true, valid: false, account: null, plan: null, error: null },
      sender: { configured: false, email: null, name: null, verified: null },
      webhook: { configured: false },
    });
    render(<SetupStatusCard />);
    await waitFor(() => expect(screen.getByText(/Dry-run/)).toBeInTheDocument());
  });
});
