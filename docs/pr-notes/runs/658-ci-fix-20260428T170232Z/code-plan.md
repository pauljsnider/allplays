# Code Plan

## Root Cause
- `edit-team.html` imports `getAllUsers` from `./js/db.js?v=76`, but the smoke fixture's `db.js?v=76` stub did not export it.
- The fixture also mocked `team-access.js?v=1` while the page imports `team-access.js?v=2`, leaving the test exposed to current real-module behavior.
- Browser module initialization could abort before the admin invite click path completed, leaving `#admin-invite-status` empty.

## Implementation Plan
- Add `getAllUsers()` to `EDIT_TEAM_DB_STUB` returning an empty array.
- Add `normalizeTeamPermissions()` to `TEAM_ACCESS_STUB`.
- Update the route mock to intercept `**/js/team-access.js?v=2`.

## Scope
- Test fixture only. No production code changes.
