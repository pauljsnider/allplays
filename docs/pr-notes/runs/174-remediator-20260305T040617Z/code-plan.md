# Code role plan (fallback inline)

Implementation steps:
1. Add `clearLiveSyncTimeouts()` function near existing live sync helpers.
2. Call it in:
   - `startTimer()` start-over destructive branch
   - `resetTimer()` after user confirmation before any resets/deletes
   - `cancelGame()` after confirm before deletes
3. Update `resetTimer()` `updateGame` payload to set `liveHasData: false`.
4. Update `cancelGame()` `updateGame` payload to set `liveHasData: false`.
5. Update local `currentGame.liveHasData = false` in reset/cancel flows.
