# Code Plan

## Implementation Plan
- Adjust `extractSavePlanBody` to match the current `async (e)` click handler.
- Inject a mocked `saveGamePlan` dependency into the harness and synthesize the event object expected by the handler body.
- Update save assertions to expect the current `saveGamePlan(teamId, gameId, gamePlan)` call shape.
- Update the shared-game title assertion to match the current UI string.

## Scope Control
- Only test harness expectations changed. No unrelated refactor.
