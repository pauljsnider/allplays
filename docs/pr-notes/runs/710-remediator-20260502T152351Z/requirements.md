# Requirements notes

## Acceptance criteria
- Stripe Team Pass webhook applies a public endpoint abuse control before Stripe client construction and Firestore writes.
- Unrelated paid `checkout.session.completed` events in the same Stripe account are acknowledged with `received: true` and `unlocked: false` rather than throwing.
- Team Pass unlock only proceeds when required metadata is present and valid: `teamId`, `seasonId`, `tier: team-pass`, and `purchaserUid`.
- Existing strict entitlement construction remains the final invariant check.
- Idempotent event handling for valid Team Pass events is preserved.
- Tests cover valid Team Pass unlock gating, unrelated paid sessions, missing purchaser metadata, and rate-limit behavior.
