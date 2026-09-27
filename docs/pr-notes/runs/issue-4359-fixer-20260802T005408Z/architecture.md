# Current-State Read

`TeamFees.resolveCheckoutUrl` short-circuits to `getActiveCheckoutUrl(recipient)` when stored status is open. The recipient summary normalizes `checkoutUrl`, `paymentLink`, or `paymentUrl` into that field, so arbitrary stored metadata can reach `sharePublicUrl` or `copyPublicText`. Server-returned destinations are only checked for truthiness.

# Proposed Design

Make `initiateStaffTeamFeeCheckout` the sole destination source for every share and copy action. Validate its returned destination immediately before the public-action boundary. Accept only an absolute HTTPS URL whose exact hostname is `checkout.stripe.com`, with no credentials or nonstandard port. Reject everything else with a recoverable error and no stored-data fallback.

# Files And Modules Touched

- `apps/app/src/pages/TeamFees.tsx`
- `apps/app/src/pages/TeamFees.test.tsx`
- Per-run planning artifacts under this directory

# Data/State Impacts

There is no schema or persisted-state change. Stored checkout metadata remains available for status labels, but it is no longer authoritative for distribution. The server remains responsible for deciding whether to reuse or regenerate a session.

# Security/Permissions Impacts

Existing staff authorization remains unchanged. The client trust boundary moves from mutable Firestore metadata to an authenticated server operation plus an exact destination allowlist. The blast radius is limited to staff Team Fees share and copy actions.

# Failure Modes And Mitigations

- Poisoned stored URL: ignored as a destination.
- Invalid server URL: rejected before clipboard or share APIs.
- Callable/network/auth failure: existing recipient-level error handling remains recoverable.
- Valid reuse or regeneration: canonical destination passes unchanged.
- Canonical-looking but session-unbound Stripe URL: residual server-side risk owned by the parent server-authoritative slice.
