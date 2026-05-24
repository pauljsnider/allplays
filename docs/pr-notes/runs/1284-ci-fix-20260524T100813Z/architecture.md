# Architecture Notes

## Acceptance Criteria
- `game-plan.html` continues to normalize saved game plan lineups through `normalizeLineupsForGamePlanPlanner` when loading a game.
- Unit harness mirrors the browser module scope closely enough to execute `loadGame` without undefined imported helpers.

## Architecture Decision
The production code is already correct: `game-plan.html` imports `normalizeLineupsForGamePlanPlanner` from `js/game-plan-interop.js`. The failure is test drift caused by extracting `loadGame` into a `new Function` harness without injecting that imported symbol.

## Risk And Rollback
Risk is limited to the unit test harness. Rollback is reverting the test import and dependency injection if a better harness abstraction replaces the source extraction approach.
