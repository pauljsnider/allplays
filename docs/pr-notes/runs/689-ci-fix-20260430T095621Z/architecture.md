# Architecture Notes

## Acceptance Criteria
- Team schedule smoke tests must load `team.html` with mocked ES modules.
- Existing schedule filtering behavior must remain unchanged.

## Root Cause
`team.html` imports `saveTeamAvailabilityPreferences` and `getRsvps` from `js/db.js`. The smoke test replaces `js/db.js` with an inline module stub, but that stub did not export the newly imported names. Browser ES module linking failed before `loadTeam()` could render the header or schedule list.

## Decision
Update only the smoke-test DB stub to export no-op availability helpers. This preserves production code and fixes the test harness contract.

## Risks And Rollback
Risk is limited to smoke tests. Rollback is the single test-stub change.
