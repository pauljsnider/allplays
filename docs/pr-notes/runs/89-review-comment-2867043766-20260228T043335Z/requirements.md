# Requirements Role Summary

## Objective
Fix the daily recurrence interval bug so generated practice occurrences match user-entered day spacing.

## User-visible expectation
- A series with `freq: daily` and `interval: N` appears every N days.
- No hidden acceleration in schedule generation.

## Acceptance criteria
- Interval 1 yields daily occurrences.
- Interval 3 yields dates separated by exactly 3 calendar days.
- Weekly logic remains unchanged.
- Ex-date and override behavior remains unchanged.
