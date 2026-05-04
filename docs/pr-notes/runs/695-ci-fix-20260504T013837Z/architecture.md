# Architecture Notes

## Acceptance Criteria
- `loadGame(game)` compiles in the unit-test harness and browser script.
- Read-only save behavior remains unchanged for calendar and shared tournament games.
- The fix is scoped to the duplicate declaration causing CI failure.

## Architecture Decisions
- Keep the existing single read-only calculation inside `loadGame` and reuse it for both the status badge and save button/note state.
- Do not introduce new helpers or change persistence behavior.

## Risks And Rollback
- Risk is low: the change removes a duplicate lexical declaration only.
- Rollback is reverting the one-line removal if a downstream behavior regression appears.
