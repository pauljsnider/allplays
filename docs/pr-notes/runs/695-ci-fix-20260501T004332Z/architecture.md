# Architecture Notes

## Acceptance Criteria
- Game switching tests continue to validate that stale lineup state is cleared when loading a different game.
- Save behavior is validated against the current `saveGamePlan(teamId, gameId, gamePlan)` abstraction instead of the older `updateGame(..., { gamePlan })` call path.
- Read-only shared games keep the Save Plan button disabled with the current UI title text.

## Architecture Decisions
- Keep production `game-plan.html` unchanged. The branch intentionally saves through `saveGamePlan`, which directly patches the game plan and avoids broader `updateGame` side effects.
- Update the unit harness to match the current event handler signature and injected dependency name.

## Risks And Rollback
- Risk is limited to test harness alignment. No runtime behavior changes.
- Rollback is reverting `tests/unit/game-plan-switching.test.js` if production code changes back to `updateGame`.
