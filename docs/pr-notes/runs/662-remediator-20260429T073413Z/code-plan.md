# Code Plan

## Implementation Plan
- Replace the RSVP reminder whole-object metadata update with dot-path audit fields.
- Add event-type-aware link selection in `buildPreEventReminderPayload`.
- Add source-inspection unit coverage for the RSVP audit-only update and practice link routing.

## Files Expected
- `edit-schedule.html`
- `functions/index.js`
- `tests/unit/edit-schedule-notifications.test.js`
- `tests/unit/pre-event-reminder-dispatcher.test.js`
