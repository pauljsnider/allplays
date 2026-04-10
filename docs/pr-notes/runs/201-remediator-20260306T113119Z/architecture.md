Current state:
- `js/accept-invite-flow.js` is the caller boundary for the admin invite flow.
- `js/db.js:redeemAdminInviteAtomically()` is still the transactional control point.

Proposed state:
- Add a caller-side contract check before using `redeemResult.teamName`.

Blast radius:
- Single branch inside `processInviteCode()`.
- No schema, routing, or transaction changes.
