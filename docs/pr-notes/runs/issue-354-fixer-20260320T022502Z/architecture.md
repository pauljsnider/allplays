Current state:
- `edit-schedule.html` performs URL validation with a direct string check and merges imported ICS events inline inside `loadSchedule()`.
- Duplicate suppression currently depends on in-page logic for tracked calendar IDs and timestamp collisions with DB events.

Proposed state:
- Add `js/edit-schedule-calendar-import.js` with pure helpers:
  - `validateCalendarImportUrl(url)`
  - `mergeCalendarImportEvents(...)`
- `edit-schedule.html` imports and uses those helpers, leaving rendering and persistence behavior unchanged.

Why this shape:
- Pure helpers are directly testable in Vitest without adding a browser harness.
- The helper boundary is narrow and preserves existing data flow and UI behavior.

Controls / rollback:
- No storage, auth, or Firestore contract changes.
- Rollback is isolated to removing the helper import and restoring the prior inline logic in `edit-schedule.html`.
