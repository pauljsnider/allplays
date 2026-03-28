Objective: remediate the three unresolved PR #379 review findings with the smallest possible code change.

Current state:
- `buildCompletedGamePlayerStatsPayload()` preserves prior `timeMs` even when `didNotPlay` is true.
- `game.html` computes `statKeys` and `hasPlayingTime` once during `loadGame()`, then reuses stale values after post-game edits.
- `formatMMSS()` is already defined at script scope on the current branch, so the P1 report appears stale rather than requiring a new code change.

Required outcomes:
- A DNP correction must persist `timeMs: 0`.
- Saving the first foul in the editor must immediately expose the `FOULS` report column without reload.
- Existing playing-time formatting must remain callable anywhere the page renders minutes.

Assumptions:
- No additional product behavior is intended beyond the review comments.
- Minimal validation via focused unit tests is sufficient because the repo has no browser automation for this flow.
