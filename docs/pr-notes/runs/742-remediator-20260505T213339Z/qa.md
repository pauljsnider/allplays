# QA Plan

Subagent note: role-specific sessions_spawn was unavailable, so this is inline QA analysis.

## Automated
- Run focused unit test: `npx vitest run tests/unit/registration-review.test.js`.

## Manual
- In edit roster registration review, verify pending/approved/rejected/all filters return expected registrations.
- Approve a pending registration as a team admin into a new player and confirm player creation plus registration approval succeeds without `PERMISSION_DENIED` from `/users/{guardianId}`.
- Approve a pending registration into an existing player and confirm audit metadata records `existing-player`.
- Reject a pending registration and confirm registration remains visible under rejected.

## Rule Check
- Confirm `firestore.rules` registration updates/deletes remain gated by `isTeamOwnerOrAdmin(teamId)`.
