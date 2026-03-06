# QA Role Summary

- Regression targets:
  - Redemption failure path still triggers only auth rollback.
  - Profile-write failure path triggers invite rollback then auth rollback.
  - Success path unchanged.
- Added unit coverage:
  - Asserts invite rollback not called when redemption itself fails.
  - Asserts invite rollback called with `(userId, inviteCode)` and ordered before auth rollback when profile write fails.
- Residual gap:
  - No integration test harness here for Firestore rollback helper behavior; validated by code inspection only.
