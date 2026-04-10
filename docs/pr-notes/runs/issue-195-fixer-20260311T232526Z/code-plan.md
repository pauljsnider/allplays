Implementation plan:
1. Add `js/game-day-lineup-publish.js` for pure payload and notification helpers.
2. Add a focused unit test file covering helper behavior and `game-day.html` publish wiring.
3. Update `game-day.html` to:
   - import the new helpers and `postChatMessage`
   - replace the single save button with draft/publish controls
   - persist publish metadata and notification recipient ids
   - post a chat notification on publish
   - render publish status text
4. Run focused unit tests, then the repo unit suite if stable.
