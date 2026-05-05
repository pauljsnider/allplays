# Code Plan

## Implementation Plan
- Edit only `tests/smoke/team-schedule-calendar.spec.js`.
- Add missing named exports to the `buildDbStub` JavaScript string:
  - `getRsvpSummaries()` returns `new Map()`
  - `submitRsvp()` returns `undefined`
  - `getMyRsvp()` returns `null`
- Re-run affected smoke spec.

## Summary
The fix is test-only and aligns the smoke stub with the current `team.html` DB import contract.
