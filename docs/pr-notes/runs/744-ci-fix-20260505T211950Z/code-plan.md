# Code Plan

## Patch Plan
- Add `createOfficiatingAssignmentNotificationRecords` as a no-op async export to the DB stubs in:
  - `tests/smoke/edit-schedule-calendar-import.spec.js`
  - `tests/smoke/edit-schedule-calendar-cancelled-import.spec.js`

## Scope
- Test harness only. No production code changes.
