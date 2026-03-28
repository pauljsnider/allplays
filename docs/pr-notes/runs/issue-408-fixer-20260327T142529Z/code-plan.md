Thinking level: medium
Reason: the code path is stateful and UI-heavy, but the safest fix is a small extraction into pure helpers plus a targeted replay-mode bug fix.

Plan:
1. Add a new unit test file for replay bootstrap and replay timeline behavior.
2. Extract pure replay helpers into `js/live-game-replay.js`.
3. Update `js/live-game.js` to consume those helpers and lock chat consistently in replay mode, including the no-events fallback.
4. Run targeted unit tests, inspect diff, and commit with issue reference.
