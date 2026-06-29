# Code Plan

## Root Cause
- `team.html` was cache-busted to import `./js/db.js?v=76`.
- `tests/smoke/team-schedule-calendar.spec.js` still mocked `**/js/db.js?v=76`, so the smoke fixture missed the active import.

## Files To Change
- `tests/smoke/team-schedule-calendar.spec.js`

## Implementation Plan
- Change the db module route in `mockTeamPageModules` from `**/js/db.js?v=76` to `**/js/db.js?v=76`.

## Validation Commands
- `npx playwright test -c playwright.smoke.config.js tests/smoke/team-schedule-calendar.spec.js`
