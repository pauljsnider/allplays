# Code Plan

Root cause: `edit-schedule.html` imports `describeScheduleReminderWindow` from `./js/schedule-notifications.js?v=3`, but Playwright smoke stubs for `schedule-notifications.js` did not export it. Browser module loading fails with a missing named export before page initialization, so `#schedule-list` remains blank.

Patch:
- Add `export function describeScheduleReminderWindow() { return 'Team default reminder window: 24 hours before event start.'; }` to both affected smoke stubs.
- Strengthen the unit alignment check to assert the smoke specs include this export.

Commit message: `fix:address-ci-failure: add schedule notification smoke stub export`
