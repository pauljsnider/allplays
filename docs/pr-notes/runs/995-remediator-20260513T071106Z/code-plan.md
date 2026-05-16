# Code Plan

Subagent spawn unavailable in this run, so this is inline role analysis following the orchestrator fallback.

## Implementation Plan
1. In `js/team-media.js`, replace the single-item delete `persistAndReload` call with a small explicit async path:
   - guard `state.actionInFlight`
   - clear alert
   - await `deleteTeamMediaItem(state.teamId, item)`
   - filter `state.items` by deleted item id
   - delete the id from `state.selectedIds`
   - call `render()` and show success
   - preserve existing permission/error message handling
2. In `js/team-media-utils.js`, add document extension and generic MIME constants.
3. Update `isSupportedTeamMediaDocument` to:
   - accept exact whitelisted MIME types
   - fallback to extension only when MIME is blank or generic
   - reject otherwise.

## Risks And Rollback
- Scope is limited to two review comments. Revert the two touched functions/constants if behavior regresses.
