# Code Plan

## Minimal Fix
Add `saveTeamAvailabilityPreferences` and `getRsvps` exports to the inline `buildDbStub()` module in `tests/smoke/team-schedule-calendar.spec.js`.

## Why
The production module already exports these helpers. The smoke test replaces that module, so the mock must match the imported surface area used by `team.html`.
