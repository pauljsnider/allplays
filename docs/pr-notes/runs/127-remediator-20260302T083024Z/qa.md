# QA Role Notes

- Risk to verify: No syntax regressions and cleanup path remains functional for both invite types.
- Validation plan:
  - Run static syntax check on `js/signup-flow.js`.
  - Confirm code path includes `try/catch` + cleanup call for `admin_invite`.
- Manual scenario (recommended in PR): force `redeemAdminInviteAcceptance` to throw and verify no persistent orphaned auth session.
