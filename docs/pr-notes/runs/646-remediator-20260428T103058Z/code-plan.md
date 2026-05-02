# Code Plan

## Patch scope
- `edit-team.html`
  - Add `getUserProfile` import.
  - Store `currentUserProfile` after auth initialization.
  - Use auth email with profile-email fallback in `loadRosterRolloverTeams`.
  - Add `rosterRolloverPreviewRequestId` state.
  - Increment the request id on source-team changes and when rollover is disabled.
  - Discard stale `getPlayers(sourceTeamId)` success/error results if the request id or selected team changed.
- `tests/unit/roster-rollover-preview.test.js`
  - Update static wiring assertions for profile fallback and stale preview guard.
- `tests/unit/edit-team-admin-access-persistence.test.js`
  - Update module import replacement and mock `getUserProfile`.

## Commit message
Fix roster rollover review issues
