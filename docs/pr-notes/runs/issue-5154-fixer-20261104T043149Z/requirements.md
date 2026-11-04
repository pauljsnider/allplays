# Requirements Analysis — Issue #5154

## Root cause and impact

`setPeriod()` updates `state.period` and the selected-button UI, but its audit and broadcast branch is guarded by `state.running`. A real period transition made while paused therefore creates no `period_change` event and does not call `syncClockToGameDoc()`, leaving the authoritative `liveClockPeriod` on the prior period.

`renderHeader()` does invoke `persistLocalTrackerState()`, so local persistence is indirect rather than entirely absent. On reload, initialization reapplies resume clock state derived from live events or the game document. Because both authoritative sources remain stale, they overwrite the locally selected period.

- **UX:** The selected button gives false confirmation because the UI and shared state disagree.
- **Coach/scorekeeper:** Stopping the clock before advancing a quarter is the documented workflow, so a reload or phone lock during the break can mislabel later events.
- **Parent/live viewer:** Viewers remain on the old period until the clock restarts.
- **Sports manager:** Incorrect period attribution can contaminate the permanent game record and require manual correction.

## Acceptance criteria

1. A paused Q1 → Q2 change updates the UI, local tracker snapshot, game document, and active live stream immediately.
2. The game-document update records Q2 with the current clock and `liveClockRunning: false`.
3. The live event contains the new period and current clock/score snapshot.
4. Reload/resume restores Q2.
5. Running-clock behavior remains intact.
6. Selecting the active period creates no duplicate log, sync, or broadcast.
7. The change does not start/reset the clock or alter scores, lineups, or stats.
8. Configured labels for every sport remain supported.

## Prevention / learning

Treat period as replicated clock state, not presentation state. Every meaningful user mutation must update local recovery, the authoritative game document, and the live-event stream based on whether the value changed, independent of whether the clock is running.

## Recurrence risk

**Medium** — persistence is split across three channels and resume precedence exposes any partial update.
