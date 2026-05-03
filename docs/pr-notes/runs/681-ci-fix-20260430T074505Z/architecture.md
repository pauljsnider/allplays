# Architecture Notes

Root cause is smoke-test stub drift, not production schedule rendering logic. `edit-schedule.html` imports `describeScheduleReminderWindow` from `./js/schedule-notifications.js?v=3`; the real module exports it, but imported-calendar Playwright smoke stubs did not. Browser ES module evaluation failed before `init()` / `loadSchedule()` ran, leaving `#schedule-list` as initial whitespace.

Minimal fix: add a deterministic `describeScheduleReminderWindow` export to the affected smoke stubs. No Firestore schema, data model, calendar merge semantics, permissions, RSVP, recurrence, or runtime app behavior changes are required.

Files:
- `tests/smoke/edit-schedule-calendar-import.spec.js`
- `tests/smoke/edit-schedule-calendar-cancelled-import.spec.js`
- `tests/unit/edit-schedule-calendar-import.test.js`
