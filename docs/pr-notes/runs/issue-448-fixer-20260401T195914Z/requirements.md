## Objective

Add regression coverage for the parent dashboard manual access-code redemption path so expired parent invites are rejected before any parent-linking side effects occur.

## Current State

- `parent-dashboard.html` lets a signed-in parent enter a code and calls `redeemParentInvite()` directly.
- `redeemParentInvite()` already enforces expiry inside its transaction, but the dashboard path does not share the same up-front validation flow used by `accept-invite.html`.
- Automated coverage does not currently assert the dashboard wiring or the expiry guard in the parent invite redemption path.

## Proposed State

- Add automated tests that pin the dashboard redeem flow to `validateAccessCode()` before redemption.
- Keep automated coverage for the DB-layer atomic redemption guard, including the expiry check.
- Preserve the current UX pattern of showing an error alert and avoiding reload on failure.

## Risk Surface

- Blast radius is limited to parent invite code redemption from `parent-dashboard.html`.
- A regression here can incorrectly attach a parent to a player and mark a code used.
- No broader tenant segregation or PHI access pattern changes are introduced.

## Assumptions

- Matching the dashboard flow to the existing invite-acceptance validation path is the safest behavior.
- The repo’s Vitest unit suite is the appropriate place for this regression coverage.

## Recommendation

Use a targeted dashboard wiring test plus a DB guard test. Then align the dashboard flow with `validateAccessCode()` so the UI rejects expired codes consistently before attempting redemption.
