# Code Plan

## Implementation Plan
- Update `tests/smoke/edit-schedule-calendar-import.spec.js` module source stub to export `getOfficials()`.
- Update `tests/smoke/edit-schedule-calendar-cancelled-import.spec.js` DB stub to export `getOfficials()`.
- Do not modify production app code.

## Summary
- The preview-smoke failure was caused by a missing named export in test stubs after officiating slots were added to the schedule editor.
- Adding the stub keeps the page module graph loadable and lets the existing calendar import assertions execute.
