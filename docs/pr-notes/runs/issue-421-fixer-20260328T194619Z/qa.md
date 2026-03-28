# QA synthesis

- Primary regression to cover: delete an opponent with persisted stats and verify the next persisted `opponentStats` snapshot omits that player.
- Test shape:
  - Unit-level interaction test around `renderOpponents()` delete wiring.
  - Existing hydration tests remain as baseline resume coverage for persisted opponent data.
- Why this is sufficient:
  - The user-visible bug is caused by a missing persistence trigger, not by incorrect snapshot or hydration logic.
  - Verifying the delete interaction schedules writes with the filtered snapshot directly guards the regression.
- Validation target:
  - `tests/unit/live-tracker-opponent-stats.test.js`
  - relevant `vitest` run for the changed area, then broader `tests/unit` run if time/cost is reasonable.
