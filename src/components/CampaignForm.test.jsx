// Smoke test for CampaignForm. Confirms the form renders with the expected
// fields and that user input flows back through `setForm`. Not exhaustive.
// intended as the seed pattern for further UI tests (and proof that the
// vitest + Testing Library + jsdom stack works end-to-end).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CampaignForm } from './CampaignForm';

const baseForm = {
  name: '',
  sendMode: 'now',
  scheduledAt: '2026-06-01T09:00',
  frequency: 'once',
  requireOptIn: true,
  gdprMode: true,
  batchSize: 300,
  delayMinutes: 2,
};

const baseTemplates = [
  { id: 'launch', name: 'Product Launch' },
  { id: 'newsletter', name: 'Newsletter' },
];

function renderForm(overrides = {}) {
  const setForm = vi.fn();
  const onSelectTemplate = vi.fn();
  const onSelectGroups = vi.fn();
  render(
    <CampaignForm
      form={baseForm}
      setForm={setForm}
      templateOptions={baseTemplates}
      selectedTemplateId="launch"
      onSelectTemplate={onSelectTemplate}
      groups={[]}
      selectedGroupIds={[]}
      onSelectGroups={onSelectGroups}
      recipientCount={42}
      recipientLoading={false}
      {...overrides}
    />,
  );
  return { setForm, onSelectTemplate, onSelectGroups };
}

describe('CampaignForm', () => {
  it('renders the core fields', () => {
    renderForm();
    expect(screen.getByLabelText(/campaign name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email template/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /recipients/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/send now/i)).toBeChecked();
    expect(screen.getByLabelText(/schedule for later/i)).not.toBeChecked();
  });

  it('shows the recipient summary on the trigger', () => {
    renderForm();
    expect(screen.getByRole('button', { name: /recipients/i })).toHaveTextContent('All contacts');
    expect(screen.getByRole('button', { name: /recipients/i })).toHaveTextContent('42');
  });

  it('calls setForm when the user types a campaign name', () => {
    const { setForm } = renderForm();
    fireEvent.change(screen.getByLabelText(/campaign name/i), {
      target: { value: 'Q3 launch' },
    });
    expect(setForm).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Q3 launch' }),
    );
  });

  it('switches send mode when the radio is clicked', () => {
    const { setForm } = renderForm();
    fireEvent.click(screen.getByLabelText(/schedule for later/i));
    expect(setForm).toHaveBeenCalledWith(
      expect.objectContaining({ sendMode: 'schedule' }),
    );
  });

  it('reveals the date picker only in schedule mode', () => {
    const { rerender } = renderForm.__hoist__ || {};
    void rerender;
    // First render: send-now mode. No date picker.
    renderForm();
    expect(screen.queryByText(/send date/i)).not.toBeInTheDocument();
    // Schedule mode renders it.
    renderForm({ form: { ...baseForm, sendMode: 'schedule' } });
    expect(screen.getAllByText(/send date/i).length).toBeGreaterThan(0);
  });
});
