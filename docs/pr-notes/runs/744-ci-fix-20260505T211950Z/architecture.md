# Architecture Notes

## Acceptance Criteria
- Edit schedule smoke tests boot successfully with the same DB export surface required by the page modules.
- Imported, cancelled, and season record schedule rows render in the smoke harness.
- No production behavior changes.

## Architecture Decisions
- Treat the failure as test harness drift: the page now reaches officiating notification code that imports `createOfficiatingAssignmentNotificationRecords` from `js/db.js`, but the affected Playwright route stubs did not export it.
- Keep the fix in the two affected smoke DB stubs as a no-op export.

## Risks And Rollback
- Risk is low because this changes only smoke test stubs.
- Rollback by removing the stub export if production imports change again.
