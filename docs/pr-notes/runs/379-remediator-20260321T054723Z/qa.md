Validation plan:
- Run `vitest` for `tests/unit/post-game-stat-editor.test.js` and `tests/unit/game-report-stats.test.js`.
- Add assertions that a DNP payload zeroes `timeMs`.
- Add assertions that `resolveReportStatColumns()` includes `fouls` once any player stats object exposes that key.

Manual reasoning checks:
- After a correction save, `timeMap[player.id]` becomes `0` for DNP, so downstream insights and athlete summaries stop counting phantom minutes.
- Recomputing table columns from `statsMap` after each save allows the first newly-entered foul to render immediately.

Residual risk:
- No browser-level test exercises the full `game.html` rerender path.
