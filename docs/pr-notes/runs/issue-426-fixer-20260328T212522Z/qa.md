Primary regression to guard:
- Undoing or removing a stat in `track-live.html` must decrement the live-game viewer player stat sections, not just the score.

Test strategy:
- Add a unit test that reads `track-live.html` and asserts the undo/remove code paths publish a reverse `stat` event using a negative value.
- Run the targeted unit test plus adjacent live-game state tests to confirm the consumer contract still passes.

Manual spot checks recommended:
- Start a live game in `track-live.html`.
- Record a player stat.
- Verify the live-game viewer section increments.
- Undo/remove the stat and verify both score and player section decrement.
