# Code Role Notes

## Patch plan
1. In `js/auth.js`, separate parent-invite redemption from profile write in both `signup` and `processGoogleAuthResult`.
2. Keep fail-closed behavior only around `redeemParentInvite`.
3. Convert profile writes after successful redeem to best-effort logging.
4. Extend `tests/unit/auth-signup-parent-invite.test.js` with two regression tests for post-redeem profile write failure.

## Conflict resolution
- Requirements wanted user flow continuity when linking is done.
- Architecture wanted strict fail-closed only for authorization/linking boundary.
- QA wanted explicit no-cleanup assertions on best-effort failures.
- Resolved by split-try structure plus targeted tests.
