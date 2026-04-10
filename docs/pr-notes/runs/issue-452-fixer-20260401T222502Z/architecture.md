# Architecture Role

Thinking level: medium
Reason: duplicated dedupe logic across schedule and calendar surfaces, but narrow behavior and existing helpers reduce ambiguity.

Current state:
- Schedule import dedupe is centralized in `js/edit-schedule-calendar-import.js`.
- Calendar-page dedupe is embedded directly in `calendar.html`.

Proposed state:
- Extract the calendar-page ICS merge/dedupe loop into a small helper so the tracked-UID behavior is testable and consistent.

Controls and blast radius:
- No data-model changes.
- No auth or Firestore rule changes.
- Only client-side merge behavior for already-fetched events changes.

Recommendation:
- Introduce one shared helper for global-calendar ICS merging.
- Wire `calendar.html` through that helper and cover the tracked UID suppression path with unit tests.
