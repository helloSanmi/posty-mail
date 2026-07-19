// Turn the coarse send-readiness signal (GET /api/campaigns/send-readiness)
// into preflight-shaped checks so it renders in the Builder's pre-send panel
// alongside the template lint. `error` rows block Send; `warn`/`info` advise.
//
// Extracted from BuilderPage so the gate logic is unit-testable without
// mounting the whole builder.
export function readinessToChecks(readiness) {
  if (!readiness) return [];
  const checks = [];

  if (readiness.provider === 'rejected') {
    checks.push({
      code: 'provider_rejected',
      severity: 'error',
      message: 'The email provider rejected its API key — sends will fail.',
      hint: 'An admin can check Settings → Connections → Setup status.',
    });
  } else if (readiness.provider === 'dryRun') {
    checks.push({
      code: 'provider_dryrun',
      severity: 'info',
      message: 'Dry-run mode — this send will be logged, not delivered.',
      hint: 'Set BREVO_API_KEY on the backend to send for real.',
    });
  }

  if (readiness.sender && readiness.sender.configured === false) {
    checks.push({
      code: 'sender_missing',
      severity: 'error',
      message: 'No sender is configured — set a From address before sending.',
      hint: 'Settings → Connections → Sender.',
    });
  } else if (readiness.sender && readiness.sender.verified === false) {
    checks.push({
      code: 'sender_unverified',
      severity: 'warn',
      message: 'Your sender isn’t verified with the provider — messages may bounce or land in spam.',
      hint: 'Verify the sender in Brevo, or use an authenticated domain.',
    });
  }

  return checks;
}
