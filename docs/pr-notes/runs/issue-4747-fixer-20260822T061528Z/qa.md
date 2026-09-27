# Risk Matrix

- **High:** unsafe checkout navigation from HTTP or lookalike destinations.
- **High:** duplicate checkout creation from repeated interaction while pending.
- **Medium:** browser integration gap between isolated unit-tested helpers.
- **Medium:** eligible purchaser CTA rendering in the real browser module.
- **Low:** smoke discovery because the configured glob already includes the proposed spec.

# Automated Tests To Add/Update

- Add `tests/smoke/team-pass-checkout.spec.js` using the real `js/team-pass.js`.
- Assert one authenticated POST with `{ data: { teamId, seasonId, tier: 'team-pass' } }`.
- Assert disabled, busy, pending-label state and one request after a synthetic second click.
- Assert exact navigation for a canonical HTTPS Stripe Checkout URL.
- Assert no navigation and retry recovery for HTTP and hostname-lookalike destinations.
- Verify discovery with the configured `--list` command and execute the focused spec under the `smoke` project.

# Manual Test Plan

- Confirm an eligible parent or staff member sees the inactive-pass CTA.
- Confirm one click immediately enters the pending state.
- Confirm successful checkout creation navigates only to canonical Stripe Checkout.
- Confirm a failed checkout restores a retryable CTA.

# Negative Tests

- Synthetic repeated click while pending.
- HTTP Stripe URL.
- `checkout.stripe.com.attacker.example` lookalike.
- No uncaught page errors during module load or interaction.

# Release Gates

- The new spec is discovered by `playwright.smoke.config.js`.
- The focused Chromium smoke passes.
- Every issue acceptance criterion has an explicit assertion.
- The diff remains test-only except for required documentation artifacts.
- CI preview smoke remains the full browser gate.

# Post-Deploy Checks

- Confirm eligible parent and staff roles see the CTA for inactive passes.
- Confirm one click enters the pending state and canonical checkout navigation succeeds.
- Review telemetry for duplicate checkout creation requests or invalid destination errors.
