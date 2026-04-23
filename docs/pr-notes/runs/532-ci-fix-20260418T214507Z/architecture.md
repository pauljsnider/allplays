# Architecture

## Current State
- `applyLiveSubstitution()` now persists stable player IDs alongside display names in `rotationActual`.
- The CI assertions in `tests/unit/game-day-live-substitutions.test.js` still expected the older name-only payload shape.

## Proposed State
- Keep the runtime payload unchanged.
- Update the failing unit assertions to validate the additive ID fields instead of rejecting them.

## Blast Radius
- Scoped to one unit test file covering game-day live substitutions.
- No production behavior changes.

## Controls And Rollback
- Validation is the targeted Vitest file for the affected helper module.
- Rollback is a single test-file revert if needed.

## Recommendation
- Treat the persisted ID fields as intentional schema growth and assert them explicitly so the test protects the regression it was meant to cover.
