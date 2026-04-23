# QA

## Highest-Risk Scenarios
- Reloaded game-day state drops the substituted player because persisted IDs are not honored.
- Tests reject additive substitution metadata and fail CI even though runtime behavior is correct.

## Minimal Validation Plan
1. Run `npx vitest run tests/unit/game-day-live-substitutions.test.js`.
2. Confirm the persisted substitution entries assert both display names and stable IDs.

## Expected Outcomes
- The helper still preserves the on-field map across reloads.
- CI passes because the unit tests match the current persisted payload shape.

## Regression Concern
- Future payload growth should prefer partial object assertions when the behavior under test is lineup reconstruction, not exact serialization ordering.
