## Coverage Target
- Native standings engine
- Edit-team standings-config persistence

## Test Strategy
1. Add a unit test that proves `maxGoalDiff` caps cumulative differential while leaving records intact.
2. Add a unit test that proves a three-team tie is resolved by `group_head_to_head` before downstream rules.
3. Add a unit test that proves two-team ties still use direct head-to-head with the new config shape.
4. Add an edit-team unit test that saves and reloads point values, cap, and separate tie stacks.

## Regression Guardrails
- Preserve legacy single-list `tiebreakers` behavior when new fields are absent.
- Keep deterministic name ordering as the final fallback.
- Validate that new form fields round-trip through the existing update flow.

## Validation
- Run targeted Vitest suites:
  - `tests/unit/native-standings.test.js`
  - `tests/unit/edit-team-admin-access-persistence.test.js`
