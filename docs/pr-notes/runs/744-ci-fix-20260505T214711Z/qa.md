# QA Notes

## Root Cause
`edit-schedule.html` imports `createOfficiatingAssignmentNotificationRecords` from `js/db.js`, but the affected Playwright smoke tests intercept `/js/db.js` with a mock module that did not provide that named export. Browser module evaluation failed before `loadSchedule()` completed, leaving `#schedule-list` empty and preventing add/update handlers from recording calls.

## Validation
- `npx playwright test tests/smoke/edit-schedule-calendar-import.spec.js tests/smoke/edit-schedule-calendar-cancelled-import.spec.js --config=playwright.smoke.config.js --reporter=line` passed: 5/5.
- `npx playwright test --config=playwright.smoke.config.js --reporter=line` passed: 34 passed, 1 skipped.

## QA Plan
- Target the two affected specs first to prove the edit schedule harness is healthy.
- Run the full smoke suite to catch adjacent static-hosting bootstrap regressions.
