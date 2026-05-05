# Requirements Notes

## Acceptance Criteria
- Sending an RSVP reminder records audit fields without rebuilding or replacing `scheduleNotifications`.
- Existing pre-event reminder state such as `nextReminderAt`, `reminderStatus`, and `reminderSent` remains unchanged when only an RSVP reminder is sent.
- Scheduled pre-event reminders for practices do not link users to `game-day.html`.
- Game reminders continue to link to `game-day.html` when a game id exists.

## Edge Cases
- RSVP reminders can be sent when the event date is unavailable or not passed through the UI.
- Practice events stored in the shared `games` collection must route to team/schedule context.
- Disabled, sent, sending, cancelled, deleted, and past events remain ineligible for dispatcher sends.

## Non-goals
- No schema migration.
- No new notification category or destination page.
