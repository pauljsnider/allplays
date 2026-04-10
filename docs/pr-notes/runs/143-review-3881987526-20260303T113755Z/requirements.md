# Requirements Role Summary

## Objective
Resolve PR #143 recurrence review findings without broad parser rewrites.

## Acceptance Criteria
- TZID recurring daily/weekly expansion preserves source timezone wall-clock time across DST boundaries.
- Recurrence expansion returns zero occurrences when EXDATE excludes all generated instances.
- Weekly RRULE expansion with large `INTERVAL` and `COUNT` is not truncated by artificial date-window caps.
- Existing recurrence and timezone parsing behavior remains stable for covered tests.

## Non-Goals
- Support additional RRULE frequencies beyond existing DAILY/WEEKLY handling.
- Rewrite parse pipeline or event model.
