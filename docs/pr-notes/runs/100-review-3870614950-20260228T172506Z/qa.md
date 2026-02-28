# QA Role Output

## Risk Matrix
- High: Parent invite failure still produces usable auth account/session in email or Google path.
- Medium: Regression in standard activation signup side effects (`markAccessCodeAsUsed`, profile creation).
- Low: Logging text/ordering differences.

## Automated Tests To Add/Update
- Update `tests/unit/auth-signup-parent-invite.test.js` to assert for email parent-invite failure:
  - promise rejects,
  - `updateUserProfile` not called,
  - newly created auth user delete attempted.
- Add Google new-user parent-invite failure test asserting:
  - rejection,
  - user delete attempted,
  - `signOut` called,
  - `updateUserProfile` not called.

## Manual Test Plan
- Email parent invite signup with intentionally invalid invite target: confirm error surfaced and no usable account remains.
- Google parent invite signup with invalid invite target: confirm user is signed out and signup does not proceed.
- Standard activation code signup: confirm account creation and normal profile/init behavior still works.

## Negative Tests
- Simulate cleanup delete rejection and confirm original linking failure still bubbles up.
- Verify no profile write occurs on parent-link failure.

## Release Gates
- Unit test file for auth parent-invite flows passes locally.
- Git diff scoped to auth error handling and tests only (plus run notes).

## Post-Deploy Checks
- Monitor auth/logging for reduced orphan-account incidents after failed parent-link attempts.
- Spot-check support/admin reports for parent signup failure consistency across email and Google flows.
