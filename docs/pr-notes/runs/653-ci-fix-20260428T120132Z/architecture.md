# Architecture Notes

## Current state
- `edit-team.html` imports `normalizeStreamVolunteerEmailList` from `js/team-access.js`.
- Production `js/team-access.js` exports that function.
- The Playwright smoke stub for `js/team-access.js` only exports `hasFullTeamAccess` and `normalizeAdminEmailList`.

## Root cause
The smoke harness module stub drifted from the production module export contract. The edit-team module import fails before admin invite handlers are registered, so clicking `#save-admin-btn` leaves `#admin-invite-status` empty.

## Decision
Patch only the smoke stub to export `normalizeStreamVolunteerEmailList` with the same normalization semantics as the production helper. Do not change production admin invite behavior.

## Risk and rollback
- Risk is test-only and limited to the smoke harness.
- Rollback is reverting the stub export addition.
