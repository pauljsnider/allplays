# QA

## Root Cause
- The smoke harness stub for `js/schedule-notifications.js` no longer matched `edit-schedule.html` imports.
- Missing `buildScheduleNotificationTargets` caused module initialization failure, leaving `#schedule-list` unrendered.

## Validation Plan
- Run `tests/smoke/edit-schedule-calendar-import.spec.js`.
- Run `tests/smoke/edit-schedule-calendar-cancelled-import.spec.js`.
- Confirm imported practice rows show `Calendar`, `Practice`, location, and `Plan Practice`.
- Confirm cancelled imported rows show `Cancelled` and hide `Track` / `Plan Practice`.
