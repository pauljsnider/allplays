# QA Role (manual fallback)

## Test strategy
- Add unit tests around `expandRecurrence` weekly interval behavior.
- Freeze system time to keep visibility window deterministic.

## Cases
- Regression case: weekly interval 2 + Monday should skip alternating weeks.
- Control case: weekly interval 1 + Monday should remain weekly.

## Validation commands
- `./node_modules/.bin/vitest run tests/unit/recurrence-expand.test.js`
- `./node_modules/.bin/vitest run tests/unit`
