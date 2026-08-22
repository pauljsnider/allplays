# Problem Statement

The Team Pass checkout behavior exists in the legacy team-page module, but browser-level coverage does not verify the complete path from the visible CTA through checkout creation and validated navigation. Unit tests cover URL validation and pending-state logic in isolation, while existing team-page smoke coverage stubs the Team Pass module.

# User Segments Impacted

- Team owners, coaches, and administrators need a reliable purchase action without duplicate checkout sessions.
- Confirmed parents need the same trusted checkout path without being treated as staff.
- Sports program managers need predictable payment initiation and bounded provider navigation.
- All users benefit from fail-closed rejection of malformed or lookalike checkout destinations.

# Acceptance Criteria

1. The focused Playwright smoke renders the production Team Pass purchase control for an eligible purchaser with an inactive pass.
2. Clicking **Buy Team Pass** sends exactly one POST with the expected team, season, and `team-pass` tier.
3. While checkout creation is unresolved, the CTA is disabled, busy, and shows its pending label.
4. A synthetic repeated click while pending does not send a second request.
5. A canonical non-root `https://checkout.stripe.com/...` response permits navigation to the exact destination.
6. HTTP and Stripe-hostname-lookalike destinations do not navigate.
7. Invalid destination rejection restores a retryable CTA and displays the validation error.
8. The spec is discovered by `playwright.smoke.config.js` and the repository's `npm run test:smoke` entrypoint.

# Non-Goals

- Product CTA, eligibility, styling, or copy changes.
- Live Stripe payments, webhooks, or entitlements.
- Backend authorization, reservation, idempotency, or persistence changes.
- Broad team-page smoke expansion.

# Edge Cases

- A disabled button suppresses pointer clicks, so duplicate prevention must also receive a synthetic click.
- The exact Stripe hostname with the wrong protocol must fail closed.
- A hostname containing `checkout.stripe.com` is not necessarily canonical.
- External navigation must be intercepted locally to keep the smoke deterministic.
- Invalid responses must not leave the CTA disabled or busy.

# Open Questions

None blocking. The narrowest slice is a dedicated legacy Team Pass Playwright spec using the production browser module.
