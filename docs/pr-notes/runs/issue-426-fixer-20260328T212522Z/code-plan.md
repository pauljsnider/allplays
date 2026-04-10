Implementation plan:
1. Add a source-level unit test for `track-live.html` asserting reverse `stat` broadcasts in stat undo and stat removal flows.
2. Patch `track-live.html` to emit the reverse `stat` event after publishing the `undo` system event.
3. Reuse the same payload shape as the working `js/live-tracker.js` contract: `type`, `playerId`, `statKey`, `value`, `isOpponent`, score, period, clock, description, `createdBy`.
4. Run targeted unit tests.

Blocked orchestration note:
- The requested `allplays-orchestrator-playbook` skill and `sessions_spawn` tool are not available in this session, so these notes are the direct synthesis fallback.
