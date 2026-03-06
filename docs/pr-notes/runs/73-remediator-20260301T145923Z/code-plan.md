# Code role notes
- Current `js/parent-invite-signup.js` already includes:
  - optional `rollbackInviteRedemptionFn`
  - guard to skip auth rollback once invite is redeemed
- Remaining code change:
  - update `handleGoogleRedirectResult` in `js/auth.js` to clear `pendingActivationCode` in a `finally` that wraps `getRedirectResult` + processing.
  - remove now-redundant inner cleanup finally after `processGoogleAuthResult` call.
