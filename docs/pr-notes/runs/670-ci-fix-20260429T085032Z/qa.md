# QA Notes

## Acceptance criteria
- Pending finalization retry drains queued live events first.
- Finalization replay completes and clears `liveState.pendingFinish` plus persisted pending finalization.
- Live tracker dynamic test harnesses include the same imported dependencies used by `js/live-tracker.js`.
- Harness import rewriting does not swallow neighboring import statements.

## Affected tests
- `tests/unit/live-tracker-retry-queue.test.js`
- `tests/unit/live-tracker-start-over.test.js`
- `tests/unit/live-tracker-opponent-stats.test.js`

## Regression checks
Run targeted Vitest files for retry queue, start-over, and opponent stats. Run the full unit suite because the CI failure is in shared harness setup.
