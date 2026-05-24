# QA Plan

## Automated
- Run the focused Vitest file: `npx vitest run tests/unit/dashboard-parent-membership-sync.test.js --reporter=verbose`.
- The test must assert `unsubscribe()` is called once for synchronous authenticated and unauthenticated callbacks.
- The test must assert duplicate callback emissions after settling do not double-unsubscribe or change the settled result.

## Manual
- Dashboard should continue to load teams for authenticated users.
- Anonymous users should redirect to `login.html`.
