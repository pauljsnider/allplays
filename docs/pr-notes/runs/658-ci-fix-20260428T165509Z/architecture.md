# Architecture Notes

## Acceptance Criteria
- The preview smoke test for existing-user admin invite fallback initializes `edit-team.html` without module import errors.
- The test remains isolated from live Firebase modules and current cache-busted imports.
- The user-facing admin invite fallback behavior remains unchanged.

## Architecture Decisions
- Treat the failure as smoke fixture drift, not product logic failure.
- Keep the fix inside the Playwright smoke fixture because `edit-team.html` correctly imports `getAllUsers` from `js/db.js?v=76` and `normalizeTeamPermissions` from `js/team-access.js?v=2`.
- Update the route stub to match the current `team-access.js?v=2` import so the test does not fall through to the real module.

## Risks And Rollback
- Risk is low: changes are test-only and scoped to a single smoke spec.
- Rollback is reverting the spec stub additions if a broader fixture pattern replaces this test.
