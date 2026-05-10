# Code Plan

## Implementation Plan
- In `renderRegistrationScheduleImport`, add `button.disabled = false;` inside the `catch` block after `getEvents(currentTeamId)` preview loading fails.
- Do not change import planning, conflict detection, or persistence behavior.

## Files
- `edit-schedule.html`
