Thinking level: medium
Reason: single-path rendering contract with existing helper structure and low blast radius.

Plan:
1. Add unit tests for viewer opponent rendering contract in `tests/unit/live-game-state.test.js`.
2. Run the targeted test file to confirm failure before implementation.
3. Add a pure opponent-render helper in `js/live-game-state.js`.
4. Switch `js/live-game.js` to use the helper.
5. Run targeted tests, then the broader unit subset around live game and tracker helpers.
6. Commit with issue reference.
