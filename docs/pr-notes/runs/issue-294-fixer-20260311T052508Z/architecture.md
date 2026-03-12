Decision: route `calendar.html` through the same event-scoped RSVP helper already used by `parent-dashboard.html`.

Current state:
- `calendar.html` keeps `playerIdsByTeam` at team scope and never forwards child context from the clicked event.

Proposed state:
- Extend `resolveRsvpPlayerIdsForSubmission(...)` to recognize aggregated event `childIds`.
- Annotate calendar DB events with available `childId`/`childIds`.
- Pass `data-child-id` and `data-child-ids` from RSVP buttons into `submitCalendarRsvp(...)`.

Why this path:
- Smallest change that preserves an existing resolver and test style.
- Keeps blast radius inside client-side RSVP submission plumbing.
- Avoids duplicating the heavier parent-dashboard schedule model inside `calendar.html`.

Rollback:
- Revert the helper extension and calendar wiring change. No data migration required.
