# Code Role Output (manual fallback)

## Planned edits
1. Add `js/live-game-replay.js` with pure timing helpers for elapsed and start-time rebasing.
2. Update `js/live-game.js`:
   - use helper for elapsed in replay tick
   - on speed change while playing, preserve current replay clock via start-time rebasing
3. Add unit test `tests/unit/live-game-replay-speed.test.js` covering continuity across speed change.

## Validation
- `node ./node_modules/vitest/vitest.mjs run tests/unit/live-game-replay-speed.test.js`
