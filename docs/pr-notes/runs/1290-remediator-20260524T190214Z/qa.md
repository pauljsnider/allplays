# QA Plan

## Automated Validation
- Run the targeted unit test: `npx vitest run tests/unit/dashboard-parent-membership-sync.test.js --reporter=verbose`.

## Regression Coverage
- Assert dashboard still imports `checkAuth` and calls `requireSyncedAuth()` before loading parent teams.
- Execute `requireSyncedAuth()` with a synchronous authenticated callback and verify unsubscribe is called once.
- Execute `requireSyncedAuth()` with a synchronous unauthenticated callback and verify redirect plus unsubscribe.
- Execute duplicate synchronous emissions and verify the first result wins and unsubscribe is called once.

## Manual Checks If Needed
- Coach/admin dashboard loads owned/admin teams once.
- Parent dashboard includes parent-linked teams.
- Logged-out dashboard redirects to `login.html`.
