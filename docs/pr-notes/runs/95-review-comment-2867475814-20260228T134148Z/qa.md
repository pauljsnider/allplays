# QA Role Notes

## Regression Targets
- Weekly recurrence with `interval > 1` and multiple `byDays` values.
- Weekly recurrence with empty `byDays` (same weekday as series start).
- Timezone-sensitive date parsing (`YYYY-MM-DD` string start dates).

## Executed Checks
- Biweekly case: start `2026-03-04`, `byDays=['MO','WE']` excludes `2026-03-09`.
- Same recurrence under `TZ=America/Chicago` yields identical cadence dates.
- Weekly/no-`byDays` cadence remains aligned to interval week boundaries.

## Residual Risk
- No browser-manual recurrence page test executed in this run; validation is function-level via Node.
