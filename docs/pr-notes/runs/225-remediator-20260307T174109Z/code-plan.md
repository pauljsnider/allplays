Implementation plan:
1. Update the cancel/reset branch in `js/live-tracker.js`.
2. Add explicit live clock reset fields to the `updateGame()` payload:
   - `liveClockMs: 0`
   - `liveClockRunning: false`
   - `liveClockPeriod: 'Q1'`
   - `liveClockUpdatedAt: Date.now()`
3. Update the in-memory `currentGame` object to match so local state stays coherent.
4. Run a targeted diff/status check. No automated tests exist in this repo.
