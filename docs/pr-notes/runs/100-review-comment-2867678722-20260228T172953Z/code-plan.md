# Code Role Summary

## Minimal Patch
- Tighten `tests/unit/auth-signup-parent-invite.test.js` failure-path assertions:
  - verify `redeemParentInvite` invoked with expected inputs.
  - verify `markAccessCodeAsUsed` not called in parent-invite failure paths.
  - retain `updateUserProfile` negative assertion.

## Why
Makes sequencing and negative side effects explicit, reducing ambiguity in review feedback.
