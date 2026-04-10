# Requirements role output (manual fallback)

Objective: prevent expired parent invite codes from being redeemable in Parent Dashboard.

Current state:
- Parent dashboard redemption path calls `redeemParentInvite`.
- `redeemParentInvite` checks `code` + `used=false` but not `expiresAt`.

Proposed state:
- Expired `parent_invite` access codes are rejected before any profile or player mutation.
- User receives a clear expiration error (`Code has expired`).

Risk surface and blast radius:
- High if unchanged: expired invitation links can still grant parent linkage and downstream data access.
- Low for fix: targeted redemption path logic only; no schema/rules changes.

Assumptions:
- Parent invite codes use `expiresAt` when created.
- Existing UX already surfaces thrown error message from redemption call.

Recommendation:
- Add explicit expiration guard in redemption path with shared expiration utility.
- Add unit coverage for expiration helper used by redemption logic.

Success criteria:
- Expired parent invite redemption throws and does not proceed to profile/player writes.
- Non-expired codes still redeem.
