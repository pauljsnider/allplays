## Current State
`resetTeamStatConfigs` previously treated any matching `statTrackerConfigId` as a blocking reference. The local-team query and the shared-game query were both existence checks, so completed or cancelled games still prevented reset even though the UI copy promises reset is only blocked by scheduled/shared assignments.

## Proposed State
Keep the reset workflow schema-only, but narrow the guard to lifecycle-active assignments:
- local team games block reset only when they still look active, such as scheduled or live
- shared games block reset only when they still look active, not when they are completed historical records
- completed, final, cancelled, or `liveStatus: completed` games no longer block reset

## Architecture Decisions
- **Scope only `resetTeamStatConfigs`:** leave `deleteConfig` unchanged for this PR so the blast radius stays small.
- **Status-based filtering:** use `status` and `liveStatus` rather than dates. A stale scheduled game should still block reset until it is finalized or reassigned.
- **Symmetric local/shared handling:** apply the same finalized-state exclusion to both local team games and shared-game queries so behavior is consistent.
- **No historical mutation:** reset still deletes only `statTrackerConfigs`; completed games, events, and replay data remain untouched.

## Blast Radius
- Production change is limited to `js/db.js` reset guard logic.
- Test coverage is limited to reset-guard behavior plus existing schema workflow assertions.
- Main remaining product risk is any historical screen that expects the old config document to remain present after reset, but that risk already exists in the reset feature itself and is not expanded by this narrowing.

## Rollback
Revert the reset-specific helper functions and restore the broader existence-only guard in `resetTeamStatConfigs`. That would reinstate the false-block behavior for historical games but is isolated to one function.
