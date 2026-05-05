# QA notes

## Validation target
The failure mode is a blank/skeleton team page caused by smoke DB stub export drift. The fix should be validated by rerunning `tests/smoke/team-schedule-calendar.spec.js`, especially:

- `team schedule calendar shows only practices in the dedicated practice filter and modal`
- `team schedule keeps tracked duplicates and cancelled items out of the wrong filter buckets`

## Expected result
`#team-header` renders `Team A`, `#schedule-list` renders the seeded schedule entries, and filter assertions execute instead of timing out on whitespace-only containers.

## Regression risk
Low. The change is test-only and adds an inert stub for a chat helper that this schedule smoke flow does not exercise.
