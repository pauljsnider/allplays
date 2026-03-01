# Requirements Role (manual fallback)

## Objective
Prevent false-success parent invite signup outcomes. If parent invite finalization fails, the signup must fail visibly and keep the user on login with an actionable error.

## User impact
- Parent should never be redirected to `verify-pending.html` unless invite linking completed.
- Error must be surfaced from `signup()` so existing `login.html` catch block displays it.

## Acceptance criteria
1. `signup(email, password, activationCode)` throws on parent invite finalization failure.
2. `login.html` signup path does not redirect when `signup` throws.
3. Regression test covers fail-closed behavior.

## Risk / blast radius
- Limited to parent invite signup path in `js/auth.js`.
- No behavior change for coach/admin activation code flow.
