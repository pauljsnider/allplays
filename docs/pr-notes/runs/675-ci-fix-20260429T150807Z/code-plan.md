# Code Plan

## Root Cause
`edit-schedule.html` imports `getOfficials`, `addOfficial`, `updateOfficial`, and `deleteOfficial` from `js/db.js`. The affected smoke specs mock `js/db.js` but did not include those exports, so the page module failed to initialize and `loadSchedule()` never populated `#schedule-list`.

## Implementation Plan
- Add no-op officials exports to the `js/db.js` test stubs in the affected smoke specs.
- Do not modify production schedule or calendar import code.

## Files
- `tests/smoke/edit-schedule-calendar-import.spec.js`
- `tests/smoke/edit-schedule-calendar-cancelled-import.spec.js`
