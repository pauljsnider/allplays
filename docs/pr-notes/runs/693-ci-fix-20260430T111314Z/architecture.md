# Architecture Note

## Acceptance Criteria
- Team schedule smoke tests keep using deterministic module stubs for `team.html`.
- The test route for `js/db.js` matches the cache-busted import version used by `team.html`.
- No production behavior changes are required.

## Architecture Decisions
- Treat the failure as a test harness cache-bust drift issue, not an application data-loading defect.
- Update the smoke test interception from `db.js?v=76` to `db.js?v=76` because `team.html` now imports `./js/db.js?v=76`.
- Keep the fix scoped to the affected smoke spec.

## Risks And Rollback
- Risk is low: the change only restores the intended mocked module boundary in Playwright.
- Rollback by reverting the smoke route update if `team.html` returns to `db.js?v=76`.
