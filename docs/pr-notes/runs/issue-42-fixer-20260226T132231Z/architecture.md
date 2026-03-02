# Architecture Role Notes

## Root Cause
`accept-invite.html` (admin branch) mutates local `adminEmails` array but does not write it back to Firestore team doc. Downstream authorization reads `team.adminEmails`, so access fails.

## Design
1. Add `addTeamAdminEmail(teamId, email)` in `js/db.js` to persist normalized email with `arrayUnion`.
2. Add shared orchestration helper `redeemAdminInviteAcceptance` in `js/admin-invite.js` that:
- validates prerequisites
- persists team admin email
- merges `coachOf` and `roles` on user profile
- optionally marks invite code used
3. Replace duplicated inline admin invite handling in:
- `accept-invite.html`
- `js/auth.js` signup + Google onboarding paths

## Conflict Resolution
- Requirements could be met by only patching `accept-invite.html`, but that leaves `login.html`/auth onboarding flows inconsistent.
- Chosen solution centralizes behavior in one helper with minimal touch points, reducing drift while keeping patch scope narrow.

## Rollback Plan
Revert touched files in one commit; behavior returns to prior acceptance flow.
