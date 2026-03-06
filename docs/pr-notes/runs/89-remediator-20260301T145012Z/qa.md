# QA Role Notes

## Validation scope
Run recurrence unit coverage for daily and weekly interval behavior.

## Cases to verify
- Daily interval 2 and 3 produce expected spacing.
- Daily interval 1 unchanged.
- Weekly interval 2 with one day-of-week spaced biweekly.
- Weekly interval 2 with multiple byDays uses calendar week boundaries.

## Expected
No regressions in existing recurrence expansion tests.
