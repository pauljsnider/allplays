# Code Plan

## Root Cause
- The test stubs in `tests/smoke/edit-schedule-calendar-import.spec.js` and `tests/smoke/edit-schedule-calendar-cancelled-import.spec.js` for `js/schedule-notifications.js` were missing the `buildScheduleNotificationTargets` export.
- This caused a module load error when `edit-schedule.html` attempted to import it, leading to a blank schedule list and failing assertions.

## Proposed Change
- Add `export function buildScheduleNotificationTargets() { return []; }` to the `SCHEDULE_NOTIFICATIONS_STUB` in both affected smoke test files.

## Affected Files
- `tests/smoke/edit-schedule-calendar-import.spec.js`
- `tests/smoke/edit-schedule-calendar-cancelled-import.spec.js`

## Validation Steps
- Run `npx playwright test tests/smoke/edit-schedule-calendar-import.spec.js tests/smoke/edit-schedule-calendar-cancelled-import.spec.js` locally.
- Verify all three affected tests now pass.
