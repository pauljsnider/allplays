# QA Notes

## QA Plan
- Run affected unit tests for schedule notification wiring and pre-event reminder dispatcher behavior.
- Verify RSVP reminder source no longer rebuilds `scheduleNotifications` through `buildScheduleNotificationMetadata`.
- Verify practice pre-event reminders branch away from `game-day.html`.
- Verify games still retain a `game-day.html` link when a game id exists.

## Manual Checks
- In `edit-schedule.html`, confirm RSVP reminders update only audit fields under `scheduleNotifications`.
- In `functions/index.js`, confirm `event.type`/`event.eventType` drives practice routing.
