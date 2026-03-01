# QA Role (allplays-qa-expert)

## Test Strategy
1. Add unit test reproducing bug: daily recurring event with 6:00 PM start and `until` date should include final date.
2. Assert exact instance dates for deterministic verification.
3. Run focused vitest file for fast signal.

## Regression Guardrails
- Validate no false positives due to window filtering by mocking Date to match test window.
- Keep test isolated from Firebase Timestamp by using plain Date values and compatibility path in utility.

## Manual Smoke (optional)
- In scheduler UI, create daily series ending on selected date with non-midnight start; verify last day appears.
