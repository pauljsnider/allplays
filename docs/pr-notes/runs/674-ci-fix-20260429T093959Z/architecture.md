# Architecture Notes

## Acceptance Criteria
- Edit schedule smoke tests must boot `edit-schedule.html` with route-level dependency stubs.
- Calendar imports continue to render confirmed practices and cancelled events in `#schedule-list`.
- The application source remains unchanged; fix scope is isolated to the smoke harness drift.

## Architecture Decisions
- Root cause is test harness drift: `edit-schedule.html` now imports `getOfficials` from `js/db.js`, but the calendar smoke stubs did not export it.
- Browser module loading fails before auth/bootstrap invokes `loadSchedule`, leaving `#schedule-list` empty.
- Add a minimal `getOfficials()` stub returning an empty officials directory in the two affected smoke harnesses.

## Risks And Rollback
- Risk is low because only smoke test stubs change.
- Rollback by removing the added stub exports if the page no longer imports `getOfficials`.
