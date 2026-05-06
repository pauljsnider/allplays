# Architecture Notes

## Architecture Decisions
- Treat manual RSVP reminder sends as audit-only updates.
- Use Firestore dot-path updates for RSVP audit fields to avoid whole-map replacement of `scheduleNotifications`.
- Keep pre-event scheduling fields owned by create/update/cancel flows and the scheduled dispatcher.
- Make reminder deep links event-type aware: games use `game-day.html`, practices use `team.html`.

## Data/State Impact
- No Firestore schema changes.
- No permission changes.
- Existing reminder fields are preserved unless the specific flow owns changing them.

## Risks And Rollback
- Risk: `team.html` is less specific than a dedicated practice detail page. It is safe and valid today.
- Rollback: revert the dot-path audit update and event-type link branch if regressions appear.
