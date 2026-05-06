# Architecture Notes

## Acceptance Criteria
- `edit-schedule.html` must boot in the preview smoke route harness.
- Calendar import rows and saved DB rows must render into `#schedule-list`.
- The smoke harness must stub every named export imported by `edit-schedule.html`.

## Architecture Decisions
- Keep production code unchanged. The failure was isolated to smoke-test module drift.
- Add the missing `createOfficiatingAssignmentNotificationRecords` export to the `/js/db.js` route stubs used by the affected edit schedule smoke specs.
- Return an empty array because these tests do not exercise officiating notification creation.

## Risks And Rollback
- Blast radius is limited to smoke tests. No runtime app behavior changes.
- Rollback is removing the added mock export if production imports change again.
