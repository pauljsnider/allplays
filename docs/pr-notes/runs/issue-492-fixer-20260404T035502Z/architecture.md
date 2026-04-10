Current state:
- `edit-schedule.html` calls `loadSchedule()`, fetches DB events plus calendar events, then renders merged rows.
- `mergeCalendarImportEvents()` normalizes imported rows before `renderCalendarEvent()` decides the visible CTA.

Proposed state:
- Preserve imported calendar `dtend` during merge so `buildPracticePlanHref()` can compute duration for imported practice planning.
- Add a page harness that stubs imported modules at the network layer while still executing the real HTML and merge helper.

Blast radius:
- Low. The code change is confined to the calendar import helper.
- Browser test blast radius is isolated to a new Playwright file and local stubs.

Controls:
- No production dependency changes.
- No auth or Firestore behavior changes.
- Existing helper behavior for tracked UID suppression, conflict suppression, and cancellation stays intact.
