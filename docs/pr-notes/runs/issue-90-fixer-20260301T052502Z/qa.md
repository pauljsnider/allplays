# QA Role (manual fallback)

## Regression target
`js/auth.js` parent invite signup catch block must not suppress invite redemption errors.

## Test strategy
- Add unit regression test that inspects `signup()` parent invite catch block in source and enforces throw behavior.
- Run targeted vitest command for new test file.

## Manual checks
1. Open `login.html?code=<parent_code>`.
2. Force parent invite redemption failure (invalid/redeemed/deleted target).
3. Confirm error shown on login page and no redirect to `verify-pending.html`.

## Residual risk
- Google new-user parent invite path has similar suppression pattern; out of scope unless explicitly requested.
