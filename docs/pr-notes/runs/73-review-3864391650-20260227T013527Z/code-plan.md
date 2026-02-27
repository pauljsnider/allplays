# Code Role Plan and Outcome

- Implemented `rollbackInviteRedemptionFn` support in `finalizeParentInviteSignup`.
- Added `rollbackParentInviteRedemption(userId, code)` in `js/db.js`:
  - Validates target code and ownership (`usedBy === userId`).
  - Rebuilds user parent linkage arrays without the failed invite.
  - Removes matching `parents[]` entry from player doc when available.
  - Reopens code by resetting `used`, `usedBy`, and `usedAt`.
- Wired both parent-invite signup flows in `js/auth.js` (email/password + Google) to pass rollback handler.
- Updated unit tests for failure-path branching and compensation ordering.
