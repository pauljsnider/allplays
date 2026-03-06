# Code Role Notes

## Implementation Plan
1. Edit `js/live-game.js` `init()` to compute `playersPromise` conditionally by `state.isReplay`.
2. Keep all other data-loading and render flows unchanged.
3. Update `tests/unit/player-soft-delete-policy.test.js` assertions for the new conditional query pattern.
4. Run targeted test file and commit only scoped files.

## Orchestration Fallback
Requested `allplays-orchestrator-playbook`/role subagent spawning is unavailable in this session, so analysis was completed inline and persisted here.
