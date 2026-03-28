# Code Role Plan

Thinking level: medium (small targeted patch, no refactor).

## Minimal patch steps
1. In `track-live.html` `resetTimer()`, include `liveStatus: 'scheduled'` in `updateGame` payload and sync local `currentGame.liveStatus`.
2. In `track-live.html` `cancelGame()`, delete `liveEvents` collection during cancellation.
3. In `track-live.html` `cancelGame()`, always send reset metadata payload with `liveHasData: false`, `liveStatus: 'scheduled'`, zero scores, and empty `opponentStats`; keep opponent identity fields.
4. In `js/live-tracker.js` start-fresh clear path, set `liveHasData: false` and `liveStatus: 'scheduled'` in payload and local `currentGame` state.
5. Run targeted unit test for `tests/unit/track-live-state.test.js`.
