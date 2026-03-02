## Current-State Read
`redeemAdminInviteAtomicPersistence` performs a single Firestore transaction that updates team admin emails, user profile, and access-code usage together. Security rules require team update callers to already be team owner/admin (`isTeamOwnerOrAdmin`), so first-time invitees can fail before membership is granted.

## Proposed Design
Use a two-phase flow:
1. Validate team + code preconditions (exists, type, team match, unused).
2. Persist user role grant (`users/{uid}` with `coachOf` + `roles`) first.
3. Run a transaction for `team` + `accessCode` updates so code usage and admin-email write remain coupled after access exists.

This satisfies the permission dependency while keeping the risky final writes coupled.

## Files And Modules Touched
- `js/db.js` (`redeemAdminInviteAtomicPersistence`)

## Data/State Impacts
- `users/{uid}` gets `coachOf: arrayUnion(teamId)` and `roles: arrayUnion('coach')` before team update.
- `teams/{teamId}.adminEmails` still gets normalized invited email.
- `accessCodes/{codeId}` still transitions to `used: true` with audit fields.

## Security/Permissions Impacts
- Directly aligns write order with current rules: gain `coachOf` entitlement first, then perform team update requiring team-level access.
- Keeps validation checks on code and team prior to writes.
- Avoids widening rules or access scope.

## Failure Modes And Mitigations
- If user grant succeeds but final transaction fails, code remains unused and flow errors explicitly; retry path remains available.
- Concurrent redemption attempts are gated by transaction check on `code.used` before code/team commit.
- Idempotent `arrayUnion` minimizes duplicate role artifacts on retries.
