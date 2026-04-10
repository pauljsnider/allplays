Thinking level: low. The failure is a direct syntax break in a test harness caused by source/test drift.

Implementation steps:
1. Update the `live-game-state` import rewrite in `tests/unit/live-game-replay-init.test.js` to include `renderOpponentStatsCards` and use a regex so version bumps do not break the fixture.
2. Add a no-op `renderOpponentStatsCards` stub to the injected `deps.liveGameState` object.
3. Run the targeted unit test file and commit the scoped fix if green.
