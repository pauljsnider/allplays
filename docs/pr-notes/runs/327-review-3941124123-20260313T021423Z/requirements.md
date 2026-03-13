## Requirements Role

- Problem: admin-invite signup must call `redeemAdminInviteAcceptance(...)` with the current atomic-persistence contract, or new coach/admin signups fail at runtime.
- Current state: `js/signup-flow.js` and `js/auth.js` still pass removed callback parameters from the pre-refactor API.
- Proposed state: both signup paths pass only `userId`, `userEmail`, `teamId`, `codeId`, `getTeam`, and `getUserProfile`, then keep profile finalization separate.
- Blast radius: limited to new admin-invite signup flows for email/password and Google OAuth; parent invites and standard activation remain unchanged.
- Acceptance criteria:
  - email/password admin invite signup reaches `redeemAdminInviteAcceptance(...)` without obsolete arguments
  - Google admin invite signup reaches the same helper without obsolete arguments
  - regression tests fail if old parameters are reintroduced
