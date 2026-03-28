Implementation plan:
1. Update `buildCompletedGamePlayerStatsPayload()` so DNP corrections zero `timeMs`.
2. Refactor the `game.html` stats-table render path to recompute `statKeys`, `statLabels`, and `hasPlayingTime` whenever the editor rerenders the table.
3. Extend focused unit tests for the changed helper behavior.
4. Run the focused tests, then stage and commit only the remediation files.
