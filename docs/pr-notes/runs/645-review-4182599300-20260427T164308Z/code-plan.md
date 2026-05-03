# Code Role

## Implementation Plan
1. Update `tests/smoke/admin-invite-redemption.spec.js` to intercept `**/js/db.js*` for both edit-team and accept-invite dependency stubs.
2. Add stubbed exports required by `edit-team.html` after roster rollover import changes:
   - `getUserTeamsWithAccess`
   - `getPlayers`
   - `copySelectedPlayersForTeamRollover`
3. Keep production files unchanged.

## Expected Outcome
The existing-user admin invite smoke test boots with its mocked DB module regardless of cache-bust version and verifies the admin invite fallback contract.
