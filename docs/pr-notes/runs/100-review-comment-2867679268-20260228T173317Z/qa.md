# QA Role Notes

## Regression risks targeted
- False hard-failure after successful invite redeem.
- Inadvertent cleanup/sign-out on recoverable profile-write error.
- Behavior drift in standard activation code flow.

## Tests added/updated
- Keep existing tests for redeem failure in email/password and Google parent invite paths.
- Add coverage for `updateUserProfile` failure after successful redeem in both paths; assert flow resolves and no cleanup is executed.
- Preserve standard activation code happy path assertion.

## Validation scope
- Unit test file: `tests/unit/auth-signup-parent-invite.test.js`.
- Impacted workflows: parent invite signup (email/password), parent invite signup (Google), standard activation signup.
