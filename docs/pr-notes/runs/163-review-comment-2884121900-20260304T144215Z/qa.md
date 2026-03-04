# Risk Matrix
- High: Missing in-window occurrences for long-running series due to traversal/iteration constraints.
- Medium: Boundary off-by-one around computed `windowStart` and `windowEnd`.
- Low: Regression to existing daily/biweekly recurrence tests from unrelated changes.

# Automated Tests To Add/Update
- Update `does not drop in-window occurrences for long-running weekly series` in `tests/unit/recurrence-expand.test.js` to assert exact in-window count and no-gap cadence.

# Manual Test Plan
- Not required for this scope (unit-test-only regression guard).

# Negative Tests
- Assert no date gaps by checking all adjacent occurrence deltas are exactly 7 days.
- Assert count equals expected in-window Mondays so hidden missing occurrences fail.

# Release Gates
- `npx vitest run tests/unit/recurrence-expand.test.js` passes.
- Git diff limited to test and run-note artifacts.

# Post-Deploy Checks
- PR CI should pass unit suite including recurrence tests.
