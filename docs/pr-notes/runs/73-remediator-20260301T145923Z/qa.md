# QA role notes
- Validate parent invite flow failure after redemption:
  - Simulate `updateUserProfile` failure.
  - Confirm auth user is not deleted when invite was already redeemed.
  - Confirm rollback hook is attempted and errors are logged, not swallowed silently.
- Validate Google redirect cleanup:
  - Force error in redirect processing path and verify `sessionStorage.pendingActivationCode` is removed.
  - Verify no regression when redirect result is absent.
