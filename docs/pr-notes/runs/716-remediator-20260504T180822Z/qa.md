# QA Plan

## Validation
- Static inspect `firestore.rules` to confirm `isScorekeepingGameUpdate` requires both field allowlist and non-destructive lifecycle state.
- Confirm owner/admin path remains `isTeamOwnerOrAdmin(teamId) || isScorekeepingGameUpdate(teamId, gameId)`.
- No automated test runner is defined in `AGENTS.md`; manual Firebase rules emulator tests are recommended if available in CI.

## Scenarios
- Non-admin scorekeeper updating score fields succeeds when game is not cancelled/deleted.
- Non-admin scorekeeper update with `status: cancelled` is rejected.
- Non-admin scorekeeper update with `liveStatus: deleted` is rejected.
- Owner/admin can still cancel or delete according to existing permissions.
