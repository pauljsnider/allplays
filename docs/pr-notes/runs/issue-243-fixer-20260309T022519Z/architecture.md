Objective: fix ICS recurrence handling in the smallest layer that serves both schedule sync entry points.

Current state:
- `fetchAndParseCalendar(...)` centralizes ICS ingestion.
- `parseICS(...)` parses raw VEVENTs and expands RRULE masters, but it does not reconcile `RECURRENCE-ID` exceptions against the generated series.

Proposed state:
- Keep the change inside `js/utils.js`.
- Parse raw VEVENTs first, then post-process them into final calendar events:
  - standalone events pass through
  - RRULE masters expand into occurrences
  - `RECURRENCE-ID` VEVENTs replace the matching generated occurrence for the same UID
  - recurring occurrences receive stable IDs derived from UID + occurrence anchor

Blast radius:
- Shared parser contract used by `edit-schedule.html` and `calendar.html`
- No Firestore schema changes
- No UI flow changes

Controls:
- Preserve existing `uid`, `status`, and date parsing behavior.
- Add focused unit coverage around recurrence exceptions and instance IDs.

Rollback:
- Revert the parser/test commit if downstream consumers surface unexpected event identity assumptions.
