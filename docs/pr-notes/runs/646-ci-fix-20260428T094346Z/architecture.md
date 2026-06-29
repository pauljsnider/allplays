# Architecture Notes

## Root cause
The preview smoke test mocked `js/db.js?v=76` and `js/utils.js?v=8`, but the page under test imports additional named exports from those modules. Because the route stubs did not export every named import required by `edit-team.html`, the browser module graph could fail during initialization and the admin invite click handler would never attach. The visible symptom was `#admin-invite-status` remaining empty after clicking `#save-admin-btn`.

## Affected files/functions
- `tests/smoke/admin-invite-redemption.spec.js`
  - `EDIT_TEAM_DB_STUB`
  - `EDIT_TEAM_UTILS_STUB`
- Page behavior under test remains in `edit-team.html` and `js/edit-team-admin-invites.js`; no production logic change is required.

## Minimal fix
Keep the smoke test stubs aligned with the named imports used by `edit-team.html` by adding no-op `getUserTeamsWithAccess()` and `getPlayers()` DB exports and an `escapeHtml()` utility export.

## Risks and rollback
Risk is limited to smoke-test scaffolding. Rollback is reverting this test stub alignment if the page imports change again or if a broader shared stub is introduced.
