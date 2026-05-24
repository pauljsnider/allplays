# Code plan

## Implementation Plan
- Update `tests/smoke/edit-schedule-calendar-import.spec.js` so the upcoming filter expects cancelled imports to be absent.
- Update `tests/smoke/edit-schedule-calendar-cancelled-import.spec.js` so cancelled row rendering and hidden action assertions run after switching to Past Events.
- No production code changes are required for this CI classifier.
