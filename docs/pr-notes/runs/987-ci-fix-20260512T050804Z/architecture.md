# Architecture notes

## Root cause
The smoke test mocks are tied to stale cache-bust query strings for `auth.js` and `team-access.js`. The page imports were advanced to `auth.js?v=38` and `team-access.js?v=3`, so Playwright did not intercept the modules and the admin invite flow ran with unintended real/static behavior.

## Minimal fix
Keep production code unchanged. Make the smoke test routes accept cache-bust version drift for the mocked modules, matching the existing regex pattern already used for `db.js`.

## Risk and rollback
Blast radius is test-only. Rollback is reverting the route matcher changes in `tests/smoke/admin-invite-redemption.spec.js`.
