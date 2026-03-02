# QA Role Summary

- Regression focus:
  - redemption failure path still removes unauthorized auth account.
  - profile-write failure after redemption does not delete auth account.
  - fallback path where invite rollback fails also keeps auth account.
- Test updates needed:
  - adjust existing unit test expectation to `rollbackAuthUserFn` not called after redeem succeeded.
- Manual smoke suggestions:
  - parent invite signup happy path.
  - transient Firestore write failure simulation after redeem to confirm account remains.
