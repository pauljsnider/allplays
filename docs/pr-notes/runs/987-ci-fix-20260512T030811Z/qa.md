# QA Notes

## Root Cause
- The failing unit test asserts that admin invite signup and invite redemption consumers use fresh cache-busted imports.
- Several files still referenced `auth.js?v=38`, and `accept-invite.html` still referenced `db.js?v=76`.

## QA Plan
- Run the targeted Vitest file: `npx vitest run tests/unit/admin-invite-signup-cache-busting.test.js`.
- Confirm the unit test that failed in CI passes locally.
- Full unit suite exposed a stale test harness replacement in `accept-invite-page.test.js`; update that fixture string and rerun the targeted page test plus unit suite.
