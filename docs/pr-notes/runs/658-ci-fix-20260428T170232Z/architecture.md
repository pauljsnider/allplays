# Architecture Notes

## Acceptance Criteria
- Preview smoke test for existing-user admin invite fallback loads `edit-team.html` without module import errors.
- Smoke fixture remains isolated from live Firebase modules and current cache-busted imports.
- User-facing admin invite fallback behavior remains unchanged.

## Architecture Decisions
- Treat the failure as smoke fixture drift, not production behavior regression.
- Keep the fix scoped to `tests/smoke/admin-invite-redemption.spec.js` because the page behavior is correct once dependencies load.
- Align route mocks and stub exports with the current page imports: `db.js?v=76` and `team-access.js?v=2`.

## Risks And Rollback
- Risk is low because the change is test-only.
- Rollback is reverting the smoke fixture additions if a shared fixture replaces this spec.
