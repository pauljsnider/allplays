# QA Role Notes

## Regression Target
Mixed `liveEvents` where newest event has `createdAt: null` must not restore stale period/clock.

## Test Strategy
- Unit test helper behavior directly in `tests/unit/live-tracker-resume.test.js`.
- Keep existing tests for timestamped-only, untimestamped-only, and mixed progression.
- Add explicit mixed-recency test where latest untimestamped event has lower clock than stale timestamped event.

## Pass Criteria
- Targeted unit test file passes in Vitest.
- No regressions in existing helper tests.
