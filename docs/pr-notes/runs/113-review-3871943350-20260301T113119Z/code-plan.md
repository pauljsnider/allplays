# Code Role Plan and Outcome

- Thinking level: medium (small but security-sensitive auth behavior changes).

## Plan

1. Inject `signOut` dependency into email/password signup flow helper.
2. Add cleanup block to parent-invite catch in `executeEmailPasswordSignup`.
3. Add cleanup + rethrow to Google parent-invite catch in `processGoogleAuthResult`.
4. Extend unit tests and add a new auth regression test for Google path.
5. Run targeted vitest suite for changed files.

## Implemented

- `js/signup-flow.js`: parent-invite failure now attempts `user.delete()` and `signOut(auth)` before rethrow.
- `js/auth.js`: Google parent-invite failure now performs same cleanup and rethrows.
- `tests/unit/signup-flow.test.js`: verifies cleanup calls on parent-invite failure.
- `tests/unit/auth-google-parent-invite-cleanup.test.js`: verifies Google path cleanup + propagation.
