Validation focus:
- Calendar RSVP uses selected event child scope when available.
- Calendar RSVP falls back to legacy team-linked or empty player ids when the event has no child metadata.
- Parent dashboard ambiguity checks still throw.

Regression coverage:
1. Unit test: calendar fallback returns legacy player ids when event scope is empty.
2. Unit test: calendar fallback returns an empty array for coach/no-scope events.
3. Existing unit tests: scoped calendar and parent dashboard RSVP paths.

Manual spot check after deploy:
1. Coach opens `calendar.html` for a game without `childId` metadata.
2. Clicking Going submits successfully instead of alerting the child-selection error.
3. Parent linked to multiple children still sees scoped child behavior on events with `childIds`.

Impacted workflows:
- `calendar.html` RSVP buttons for DB games and practices.
- `parent-dashboard.html` RSVP submission remains a regression guard.
