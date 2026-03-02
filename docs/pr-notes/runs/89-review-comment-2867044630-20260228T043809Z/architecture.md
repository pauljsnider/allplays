# Architecture Role Summary

## Current State
Weekly interval gate in `expandRecurrence` used:
- `daysSinceSeriesStart`
- `Math.floor(daysSinceSeriesStart / 7)`
This anchors buckets to the exact series start day and can misclassify weekdays in the same calendar biweekly block.

## Proposed State
Compute interval buckets from week starts:
- Derive UTC day for `seriesStart` and `current` dates.
- Derive week-start UTC day via `date - getDay() * MS_PER_DAY`.
- Compute `weeksSinceSeriesWeekStart` from week-start delta.
- Keep `daysSinceSeriesStart >= 0` guard to avoid pre-series generation.

## Control Equivalence
- Same recurrence API, same data model.
- Same exDates/overrides logic.
- Change isolated to interval match predicate.
