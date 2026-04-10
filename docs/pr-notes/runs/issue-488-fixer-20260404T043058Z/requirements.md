Objective: prevent stale Game Plan assignments from leaking between games when a coach switches selections on `game-plan.html`.

Current state:
- Selecting Game A with `game.gamePlan.lineups` seeds the shared module-level `gamePlan`.
- Switching to Game B without `game.gamePlan` preserves `lineups` and prior shape because only sport defaults are reassigned.

Proposed state:
- Every game selection starts from a clean per-game plan baseline.
- Saved games hydrate from their persisted plan only.
- Unsaved games show the correct formation defaults with an empty substitution matrix.

Risk surface and blast radius:
- Real coach workflow can display and save the wrong lineup to the wrong game.
- Blast radius is limited to `game-plan.html` selection and save flow, but persisted bad plans create downstream rotation errors.

Assumptions:
- Teams still use soccer and basketball defaults defined in `game-plan.html`.
- Existing saved plans should continue to render without migration.
- Unit coverage that evaluates inline page functions is acceptable in this repo because there is no dedicated browser harness for this page.

Recommendation:
- Reset `gamePlan` from a clean default object on every `loadGame(game)` call, then merge persisted `game.gamePlan` if present.
- Add regression coverage for both render state and save payload after switching from a saved game to an unsaved game.

Success metrics:
- Switching from a saved game to an unsaved game leaves `gamePlan.lineups` empty.
- The lineup step does not render prior player assignments for the second game.
- Saving the second game sends an empty or newly created lineup only, never stale keys from the first game.
