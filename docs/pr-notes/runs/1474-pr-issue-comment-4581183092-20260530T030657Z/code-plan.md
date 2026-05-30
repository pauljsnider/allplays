# Code Role

## Implementation Plan
- Add `resolveGoalSportScorerForSide(teamSide, scorer)` in `track-live.html`.
- Change `applyRecordedGoalSportScorerStat` to accept an already-resolved player so validation can run before score mutation.
- In `recordGoalSportGoal`, block non-empty unresolved scorer before `applyGoalSportScore`, score display sync, log entry, note creation, or live broadcast.
- In goal undo, decrement attributed scorer stats from `gameState.playerStats` or `gameState.opponentStats`, update the stat cell, schedule the proper sync, and emit `broadcastReversedStatEvent`.
- Update focused unit/string-regression tests for ordering and rollback wiring.

## Conflict Resolution
- Requirements/QA preferred stronger runtime-style tests, but the nearest existing coverage for `track-live.html` uses static string/ordering assertions. Chosen path: minimal safe patch plus focused static regression assertions, matching current test style without refactoring the large static tracker.
