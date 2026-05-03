# Code Plan

## Files To Inspect
- `edit-team.html`
- `tests/smoke/admin-invite-redemption.spec.js`
- `js/edit-team-admin-invites.js`

## Minimal Patch
- Add `export async function getUserTeamsWithAccess() { return []; }` to `EDIT_TEAM_DB_STUB` in `tests/smoke/admin-invite-redemption.spec.js`.

## Validation
- Run the affected Playwright smoke spec.
