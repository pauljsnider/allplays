# Code Plan

- Inspect `game-plan.html` and `tests/unit/game-plan-switching.test.js` for the unresolved helper dependency.
- Confirm the harness imports `normalizeLineupsForGamePlanPlanner`, exposes it on `deps`, and binds it inside the generated `new Function` scope before evaluating extracted `loadGame`.
- If missing, add that injection only. If present, classify the review item as already satisfied by the current branch and commit the required remediation notes.
