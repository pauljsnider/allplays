# Code Role Plan

Thinking level: medium (cross-file logic consistency, but bounded scope)

## Plan
1. Add failing unit tests for admin invite redemption helper behavior.
2. Implement shared helper `redeemAdminInviteAcceptance` in `js/admin-invite.js`.
3. Add `addTeamAdminEmail` utility in `js/db.js`.
4. Wire helper into `accept-invite.html` admin invite branch.
5. Wire helper into `js/auth.js` signup + Google onboarding admin invite flows.
6. Run targeted unit tests.
7. Stage, commit, and report.
