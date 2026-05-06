# Code Plan

## Implementation Plan
1. Update only the smoke-test `/js/db.js` stubs for edit schedule calendar import coverage.
2. Add `createOfficiatingAssignmentNotificationRecords()` as a no-op async export returning `[]`.
3. Keep production files unchanged because the production module already has the export and the failure is test harness drift.

## Files
- `tests/smoke/edit-schedule-calendar-import.spec.js`
- `tests/smoke/edit-schedule-calendar-cancelled-import.spec.js`

## Result
The required code change is already present on the current branch in commit `7aea864b`.
