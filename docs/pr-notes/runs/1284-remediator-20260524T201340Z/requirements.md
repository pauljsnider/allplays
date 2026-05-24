# Requirements

- Address review thread `PRRT_kwDOQe-T586EXee2` by ensuring the `loadGame` unit-test harness provides every dependency referenced by the extracted `loadGame` body.
- Preserve production behavior in `game-plan.html`; no unrelated UI or planner behavior changes.
- Validation must prove `tests/unit/game-plan-switching.test.js` runs without `ReferenceError: normalizeLineupsForGamePlanPlanner is not defined`.
