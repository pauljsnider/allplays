Proposed state:
- Add a small helper that reads the latest persisted game plan from `state.game?.gamePlan` with `state.gamePlan` fallback.
- Extend `persistGamePlanWithButton(...)` to optionally run a post-persist side effect after `updateGame(...)` succeeds.
- Use that post-persist hook for the team chat publish notification so Firestore save remains the source of truth.

Blast radius:
- Scoped to lineup save/publish wiring in `game-day.html` and its targeted unit coverage.
- No schema changes and no changes to the helper payload module.
