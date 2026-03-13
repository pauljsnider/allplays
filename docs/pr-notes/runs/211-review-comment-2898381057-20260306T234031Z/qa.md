Objective: prevent regression where live or replay video restarts during ordinary game updates.

Primary risk:
- Source-reset guard could accidentally suppress legitimate reloads when the stream/replay source changes.

Regression checks:
- Same embed mode + same URL returns no reload.
- Same recorded mode + same URL returns no reload.
- Mode change or URL change still triggers reload.
- Existing replay helper coverage remains green.

Manual workflow focus:
- `live-game.html` with active live stream: score/clock updates should not restart the player.
- `live-game.html?replay=true`: replay video should remain at current position across non-video doc updates.
- Stream source change in Firestore should still swap the player.

Evidence to collect:
- Unit test output for playback-source guard.
- Grep or code inspection confirming `handleGameUpdate()` still re-runs `setupVideoPanel()` but guarded source mutation prevents reload.
