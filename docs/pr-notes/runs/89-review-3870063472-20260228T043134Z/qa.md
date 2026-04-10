# QA Role Summary

## Regression Focus
- Daily recurrences with `interval > 1` should not include in-between days.
- Daily `interval=1` and existing weekly interval behavior must remain stable.

## Test Additions
- `honors every-2-days interval for daily recurrences`
- `keeps daily interval 1 behavior unchanged`

## Validation Plan
Run targeted unit suite:
- `npx vitest run tests/unit/recurrence-expand.test.js`

## Residual Risk
- Timezone edge cases around local midnight are unchanged from existing behavior and should be covered separately if needed.
