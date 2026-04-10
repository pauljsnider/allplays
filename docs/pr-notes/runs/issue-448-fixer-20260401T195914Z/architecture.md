## Current State

- `parent-dashboard.html` owns the manual redeem button handler inline.
- `accept-invite.html` validates the access code first, then redeems.
- `js/db.js` now has a transaction-level expiry guard in `redeemParentInvite()`, which is the last line of defense.

## Proposed State

- Keep the transactional expiry guard in `redeemParentInvite()` as the authoritative control.
- Add an earlier validation call in the dashboard handler so the manual path matches the invite acceptance path.
- Cover both layers with unit tests: source-level dashboard wiring and source-level DB guard assertions.

## Blast Radius

- Single page: `parent-dashboard.html`
- Single workflow: manual parent invite redemption after sign-in
- No schema, rules, or routing changes

## Tradeoffs

- Using `validateAccessCode()` in the dashboard reuses an existing cross-flow control and keeps the patch small.
- The DB transaction guard remains necessary because UI checks alone are not sufficient for correctness.

## Recommendation

Implement the UI pre-check and leave the DB guard intact. This creates defense in depth with minimal code churn and an obvious regression signal in CI.
