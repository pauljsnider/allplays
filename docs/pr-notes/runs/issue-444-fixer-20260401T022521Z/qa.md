Test strategy
- Add one targeted regression in the unit suite.
- Save a multi-period basketball lineup via `buildLineupPublishPayload()`.
- Reload it via `buildRotationPlanFromGamePlan()`.
- Assert the persisted payload keys, restored `rotationPlan`, and normalized visible Game Day period.

Regression guardrails
- Preserve current soccer and basketball period naming.
- Preserve existing publish metadata behavior.
- Verify the page wiring imports and uses the active-period normalization helper.

Validation
- Run `npm test -- tests/unit/game-day-lineup-publish.test.js tests/unit/game-plan-interop.test.js` if supported, otherwise run the repo unit suite.
- Confirm no unrelated unit regressions.
