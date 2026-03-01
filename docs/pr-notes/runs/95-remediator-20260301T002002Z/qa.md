# QA Role Analysis (manual fallback)

## Risk Surface
- Incorrect occurrence generation cadence (over/under generation).
- Date-boundary regressions around interval checks.

## Test Strategy
- Focused unit tests in `tests/unit/recurrence-expand.test.js`:
  - Daily interval every 3 days remains correct.
  - Weekly interval for multi-day schedules aligns to week boundaries.
  - Biweekly series starting Wednesday with `['MO','WE']` must exclude Monday of immediate next week (`2026-03-09`).

## Validation Command
- `node ./node_modules/vitest/vitest.mjs run tests/unit/recurrence-expand.test.js`

## Exit Criteria
- All recurrence interval guardrail tests pass.
- Expected date sequences match review-thread examples.
