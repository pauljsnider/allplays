Objective: Prevent a cancelled live-tracker resume from restoring stale persisted clock data on the next load.

Current state: `deriveResumeClockState()` falls back to `currentGame.liveClockPeriod/liveClockMs` when `liveEvents` is empty. The reset path in `js/live-tracker.js` clears events and stats but leaves the persisted live clock on the game document untouched.

Proposed state: When the user clicks Cancel to start over, the reset metadata update must also reset the persisted live clock state so the next load starts at `Q1` / `00:00`.

Risk surface: Live tracker reset flow for basketball tracking. Blast radius is low and limited to game metadata updates during explicit reset.

Assumptions:
- Firestore `updateGame()` remains a patch update and should not be refactored in this change.
- The narrowest acceptable fix is to overwrite the persisted live clock fields during reset.

Recommendation: Reset `liveClockPeriod`, `liveClockMs`, `liveClockRunning`, and `liveClockUpdatedAt` in the cancel/reset branch. This preserves the current resume behavior while preventing stale clock resurrection after an explicit reset.
