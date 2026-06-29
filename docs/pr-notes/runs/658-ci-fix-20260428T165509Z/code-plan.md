# Code Plan

## Root Cause
- `edit-team.html` imports `getAllUsers` from `./js/db.js?v=76`, but `tests/smoke/admin-invite-redemption.spec.js` mocked `db.js?v=76` without exporting `getAllUsers`.
- Browser module initialization aborted before click handlers were attached, so clicking `#save-admin-btn` left `#admin-invite-status` empty.
- The same fixture also mocked `team-access.js?v=1` while the page imports `team-access.js?v=2`, so the test was less isolated than intended.

## Implementation Plan
- Add `getAllUsers()` to `EDIT_TEAM_DB_STUB` returning an empty array.
- Add `normalizeTeamPermissions()` to `TEAM_ACCESS_STUB`.
- Update the route mock to intercept `**/js/team-access.js?v=2`.

## Scope
- Test fixture only. No production code changes.
