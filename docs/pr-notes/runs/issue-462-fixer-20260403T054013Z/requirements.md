# Requirements Role (allplays-requirements-expert)

## Objective
Prevent admins from deleting a stat config that scheduled or live games still reference.

## Current vs Proposed
- Current: Edit Config deletes the stat config immediately and existing games keep a dangling `statTrackerConfigId`.
- Proposed: Deletion is blocked when any team game still references the config, and the admin gets a clear message explaining why.

## User Impact
- Coaches should not be able to break live or upcoming stat tracking from the config screen.
- Existing games must keep a resolvable stat set so game-day tracking remains accurate.

## Acceptance Criteria
1. Attempting to delete a config referenced by at least one game does not remove the config.
2. The delete flow shows a clear error message that the config is still assigned to games.
3. Unreferenced configs can still be deleted normally.

## Risks
- Firestore query must stay scoped to the current team to avoid cross-tenant leakage.
- UI must surface the blocked-delete state instead of failing silently.
