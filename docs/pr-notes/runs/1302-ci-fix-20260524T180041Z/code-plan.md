# Code plan

## Implementation Plan
- Root cause: upcoming schedule filtering excludes cancelled events, including imported calendar cancellation notices, so smoke expectations needed to match the branch behavior.
- Update `tests/smoke/edit-schedule-calendar-import.spec.js` so the upcoming filter expects cancelled imports to be absent.
- Update `tests/smoke/edit-schedule-calendar-cancelled-import.spec.js` so cancelled row rendering and hidden action assertions run after switching to Past Events.
- Keep existing action suppression in rendering paths for cancelled rows.
- No production code changes are required for this CI classifier.
