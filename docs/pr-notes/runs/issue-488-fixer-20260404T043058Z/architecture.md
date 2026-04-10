Objective: contain stale state by removing cross-game reuse of the module-level `gamePlan` object.

Evidence:
- `game-plan.html` initializes `gamePlan` once at module scope.
- `loadGame(game)` currently merges saved plans with `gamePlan = { ...gamePlan, ...game.gamePlan }`.
- The `else` branch only changes defaults like `formationId` and `subTimes`, leaving `lineups` intact.
- Save writes the full in-memory `gamePlan` through `updateGame(currentTeamId, currentGameId, { gamePlan })`.

Architecture decision:
- Introduce a small factory/helper that returns a fresh game-plan baseline.
- In `loadGame(game)`, rebuild `gamePlan` from defaults per selected sport, then merge persisted `game.gamePlan`.

Why this is the simplest viable path:
- It preserves existing page structure, UI flow, and Firestore payload shape.
- It reduces blast radius to one page and one state object.
- It avoids a larger refactor to externalize planner state.

Controls:
- Persisted plans keep precedence over defaults.
- Unsaved games start from explicit defaults plus empty `lineups`.
- Regression tests cover both display-state and save-payload controls.

Rollback:
- Revert the helper/reset patch in `game-plan.html` if any unexpected planner initialization issue appears.
