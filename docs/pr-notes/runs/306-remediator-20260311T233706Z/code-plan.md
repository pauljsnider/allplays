Implementation plan:
1. Add `getPersistedGamePlan()` in `game-day.html` and use it for publish/draft baselines plus publish status rendering.
2. Move publish chat notification into a post-persist callback executed only after `updateGame(...)` succeeds.
3. On post-persist notification failure, keep the lineup published and alert the coach with a partial-success message.
4. Update the targeted unit test file to lock in the new wiring.
