# QA Role Summary

## Regression Focus
- Timezone edge case where `new Date('YYYY-MM-DD')` becomes previous local day/time.
- Validate final day inclusivity is preserved for date-only `until` values.

## Tests Added
- `tests/unit/recurrence-until-inclusive.test.js`
  - New case forces `process.env.TZ='America/Chicago'` and uses `until.toDate()` returning `new Date('2026-03-03')`.
  - Expects three occurrences including final local day (`instanceDate` values ending on UTC date `2026-03-04`).

## Validation Commands
- Focused recurrence unit test run with Vitest.
