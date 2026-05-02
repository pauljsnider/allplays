# Code Plan

## Root Cause
The schedule filter and show-practices handlers called `loadSchedule()` unconditionally. In the smoke test and in fast user interaction, those controls can fire before `init()` has assigned `currentTeam`, which lets a premature schedule load fail and leave `#schedule-list` empty.

## Implementation
- Update `edit-schedule.html` so early filter/toggle interactions still update local UI state but defer `loadSchedule()` until `currentTeam` exists.
- Rely on the existing `init()` load to render with the selected `scheduleViewFilter` once team context is available.

## Files
- `edit-schedule.html`
