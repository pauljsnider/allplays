# Architecture Notes

## Acceptance Criteria
- Edit schedule smoke tests must boot `edit-schedule.html` with mocked dependencies.
- Calendar import rows must render for imported practices and cancelled calendar events.
- Fix must not change runtime schedule behavior.

## Architecture Decisions
- The failure is isolated to smoke-test dependency mocks, not production calendar merge/render logic.
- `edit-schedule.html` imports the officials directory functions from `js/db.js`; tests that intercept `js/db.js` must expose the same named exports or the module graph fails before `loadSchedule()` runs.
- Keep the fix in test stubs so production blast radius is zero.

## Risks And Rollback
- Risk: future edit-schedule imports can similarly drift from smoke stubs.
- Rollback: remove the added mock exports if the production imports are reverted.
