import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ActivityLog, describeMetadata } from './ActivityLog';

const LOGS = [
  {
    id: '1', createdAt: new Date().toISOString(), userEmail: 'sanmi@example.com',
    action: 'role.update', resource: 'role', resourceId: 'abc12345',
    metadata: { changes: { role: 'admin' } }, ip: '10.0.0.1',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  {
    id: '2', createdAt: new Date().toISOString(), userEmail: 'ops@example.com',
    action: 'user.invite', resource: 'user', resourceId: 'def67890',
    metadata: { email: 'new@example.com' }, ip: '10.0.0.2',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  },
];

describe('ActivityLog', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  test('shows the browser, which the log could not record before', () => {
    render(<ActivityLog logs={LOGS} />);
    expect(screen.getByText(/Chrome 131 on macOS/)).toBeTruthy();
    expect(screen.getByText(/Edge 131 on Windows/)).toBeTruthy();
  });

  test('filtering by person narrows the rows', () => {
    render(<ActivityLog logs={LOGS} />);
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText(/filter by person/i), {
      target: { value: 'ops@example.com' },
    });
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
    // Scoped to the table: the filter's own <option> carries the same text.
    expect(document.querySelector('tbody tr').textContent).toContain('ops@example.com');
  });

  test('filtering by action narrows the rows', () => {
    render(<ActivityLog logs={LOGS} />);
    fireEvent.change(screen.getByLabelText(/filter by action/i), {
      target: { value: 'role.update' },
    });
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  test('search reaches fields that are not currently shown', () => {
    // IP is off by default. Searching for it must still find the row —
    // otherwise search means "search the visible columns", which is not
    // what anyone pasting an address into it expects.
    render(<ActivityLog logs={LOGS} />);
    fireEvent.change(screen.getByLabelText(/search the activity log/i), {
      target: { value: '10.0.0.2' },
    });
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  test('the count reports the narrowing, as a live region', () => {
    render(<ActivityLog logs={LOGS} />);
    const count = document.querySelector('[role="status"]');
    expect(count.textContent).toMatch(/2 events/);
    fireEvent.change(screen.getByLabelText(/filter by action/i), {
      target: { value: 'role.update' },
    });
    expect(count.textContent).toMatch(/1 of 2/);
  });

  test('columns can be turned on and off, and the choice persists', () => {
    render(<ActivityLog logs={LOGS} />);
    expect(screen.queryByRole('columnheader', { name: 'IP' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /columns/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^IP$/ }));
    expect(screen.getByRole('columnheader', { name: 'IP' })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem('posty.audit.columns'))).toContain('ip');
  });

  test('the identifying columns cannot be turned off', () => {
    // A log with no "who" or "when" is not an audit trail.
    render(<ActivityLog logs={LOGS} />);
    fireEvent.click(screen.getByRole('button', { name: /columns/i }));
    ['When', 'Who', 'Action'].forEach((label) => {
      expect(screen.getByRole('checkbox', { name: new RegExp(`^${label}`) }).disabled).toBe(true);
    });
  });

  test('clearing restores every row', () => {
    render(<ActivityLog logs={LOGS} />);
    fireEvent.change(screen.getByLabelText(/filter by action/i), {
      target: { value: 'role.update' },
    });
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  test('nested metadata is flattened rather than dumped as JSON', () => {
    expect(describeMetadata({ changes: { role: 'admin' } })).toBe('changes: role → admin');
    expect(describeMetadata({ contactCount: 190 })).toBe('contact count: 190');
    expect(describeMetadata(null)).toBe('');
  });
});
