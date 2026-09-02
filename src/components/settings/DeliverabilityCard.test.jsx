// The deliverability check as rows. The check itself is unchanged; these
// pin the presentation change — a passing record is one short line, and the
// message, hint and raw TXT stay behind a Details toggle instead of sitting
// in the flow. Three passing records used to render a wall of text saying
// everything was fine.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../services/brevoApi', () => ({
  getDeliverabilityCheck: vi.fn(),
  getSenderSetting: vi.fn(),
}));

import { getDeliverabilityCheck, getSenderSetting } from '../../services/brevoApi';
import { DeliverabilityCard } from './DeliverabilityCard';

// The real shape returned for usecomplier.com: SPF and DKIM passing, DMARC
// in monitor-only mode.
const RESULT = {
  domain: 'usecomplier.com',
  spf: {
    status: 'pass',
    message: 'SPF record found.',
    found: 'v=spf1 include:spf.protection.outlook.com ~all',
  },
  dkim: {
    status: 'pass',
    message: 'DKIM record found at selector "brevo1".',
    found: 'k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A',
    selector: 'brevo1',
  },
  dmarc: {
    status: 'warn',
    message: 'DMARC policy is p=none (monitor only). Reports are collected but nothing is enforced.',
    hint: 'Once SPF and DKIM are passing, move to p=quarantine, then p=reject.',
    found: 'v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  getSenderSetting.mockResolvedValue({ effective: { email: 'hello@usecomplier.com' } });
  getDeliverabilityCheck.mockResolvedValue(RESULT);
});

describe('DeliverabilityCard', () => {
  it('prompts for a check before one has run, without inventing a verdict', async () => {
    render(<DeliverabilityCard />);
    expect(await screen.findByText('Not checked yet')).toBeInTheDocument();
    expect(screen.queryByText('All passing')).not.toBeInTheDocument();
  });

  it('disables the check until a sender is configured', async () => {
    getSenderSetting.mockResolvedValue({ effective: null });
    render(<DeliverabilityCard />);
    expect(await screen.findByText('Sender not set')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check now' })).not.toBeInTheDocument();
  });

  it('renders one row per record and rolls them up', async () => {
    render(<DeliverabilityCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));

    expect(await screen.findByText('SPF')).toBeInTheDocument();
    expect(screen.getByText('DKIM')).toBeInTheDocument();
    expect(screen.getByText('DMARC')).toBeInTheDocument();
    // One warn among three passes is "needs attention", not "all passing".
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    // The passing DKIM row names its selector rather than dumping the key.
    expect(screen.getByText('Signing at selector brevo1')).toBeInTheDocument();
  });

  it('keeps hints and raw records behind Details', async () => {
    render(<DeliverabilityCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    await screen.findByText('SPF');

    // Collapsed: no hint prose, no TXT bodies.
    expect(screen.queryByText(/move to p=quarantine/)).not.toBeInTheDocument();
    expect(document.querySelectorAll('.setting-row-pre')).toHaveLength(0);

    // The DMARC row is the one with a hint; open it.
    const toggles = screen.getAllByRole('button', { name: /Details/ });
    fireEvent.click(toggles[toggles.length - 1]);

    expect(await screen.findByText(/move to p=quarantine/)).toBeInTheDocument();
    expect(screen.getByText('v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com')).toBeInTheDocument();
  });

  it('reports a failed check without wiping the rows', async () => {
    getDeliverabilityCheck.mockRejectedValue({
      response: { data: { error: 'Could not resolve TXT for usecomplier.com: ETIMEOUT.' } },
    });
    render(<DeliverabilityCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Could not resolve TXT/);
    });
  });
});
