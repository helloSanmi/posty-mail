// The pre-send gate: turns provider/sender readiness into blocking (error)
// or advisory (warn/info) checks. This is the logic that stops a campaign
// going out into a rejected key or an unverified sender.
import { describe, expect, it } from 'vitest';
import { readinessToChecks } from './sendReadiness';

const bySeverity = (checks, severity) => checks.filter((c) => c.severity === severity);

describe('readinessToChecks', () => {
  it('returns nothing while readiness is still loading (null)', () => {
    expect(readinessToChecks(null)).toEqual([]);
  });

  it('is all-clear when the provider is ok and the sender is verified', () => {
    const checks = readinessToChecks({ provider: 'ok', sender: { configured: true, verified: true } });
    expect(checks).toEqual([]);
  });

  it('blocks send with an error when the provider key is rejected', () => {
    const checks = readinessToChecks({ provider: 'rejected', sender: { configured: true, verified: true } });
    const errors = bySeverity(checks, 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('provider_rejected');
  });

  it('blocks send with an error when no sender is configured', () => {
    const checks = readinessToChecks({ provider: 'ok', sender: { configured: false, verified: null } });
    const errors = bySeverity(checks, 'error');
    expect(errors.map((c) => c.code)).toContain('sender_missing');
  });

  it('warns (does NOT block) when the sender is unverified', () => {
    const checks = readinessToChecks({ provider: 'ok', sender: { configured: true, verified: false } });
    expect(bySeverity(checks, 'error')).toHaveLength(0);
    const warns = bySeverity(checks, 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0].code).toBe('sender_unverified');
  });

  it('flags dry-run as info (not blocking) so test sends still work', () => {
    const checks = readinessToChecks({ provider: 'dryRun', sender: { configured: true, verified: null } });
    expect(bySeverity(checks, 'error')).toHaveLength(0);
    expect(bySeverity(checks, 'info').map((c) => c.code)).toContain('provider_dryrun');
  });

  it('null verified (unknown) is not treated as unverified', () => {
    const checks = readinessToChecks({ provider: 'ok', sender: { configured: true, verified: null } });
    expect(checks).toEqual([]);
  });
});
