# QA Role

Primary regression to catch:
- An imported ICS event remains visible after tracking created a DB game with the same `calendarEventUid`.

Coverage plan:
- Extend schedule import helper coverage to assert tracked items disappear on reload while the DB-backed event remains.
- Add calendar-surface coverage that seeds one DB event plus one ICS event for the same slot and verifies only the DB event renders once the UID is marked tracked.

Failure signals:
- More than one rendered item for the same slot.
- Any remaining `source: 'ics'` rendering for a tracked UID.
- Missing DB event after suppression.

Validation:
- Run targeted Vitest files first.
- Run the full unit suite if targeted tests pass cleanly.
