# Code Role Plan

Thinking level: medium.

1. Add helper in `js/auth.js` to isolate invite-linking failure handling (`redeemParentInvite` only) and cleanup orphan auth users before rethrow.
2. Use helper in both email signup and Google signup parent-invite paths.
3. Tighten parent-invite failure tests to explicitly assert profile write and verification email are skipped on failure.
4. Run focused unit tests for `auth-signup-parent-invite`.
