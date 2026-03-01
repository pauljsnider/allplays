# QA Role Notes

## Test focus
- Weekly recurrence with `interval > 1` and multi-day `byDays`.
- Off-cadence week exclusion for days before/after anchor weekday.
- Date key consistency for exclusions/overrides (`instanceDate` string).

## Validation plan
- Run existing recurrence unit test: `tests/unit/recurrence-interval.test.js`.
- Confirm expected dates include cadence weeks only and exclude off-cadence Mondays.

## Residual risk
- Repo has limited automated coverage for timezone-specific environments; manual follow-up in browser remains useful if needed.
