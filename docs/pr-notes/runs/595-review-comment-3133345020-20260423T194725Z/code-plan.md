# Code Plan

## Minimal Patch Plan
1. Change `scheduleRetry` so it no longer clears and persists an empty queue before replay completes.
2. Remove replayed events from `liveState.eventQueue` only after a successful resend.
3. Persist queue state after each successful resend and stop replay on the first failure.
4. Add a regression test that covers partial replay failure followed by successful retry.
5. Update existing live tracker harness tests for the new queue module dependency.

## Files Likely Touched
- `js/live-tracker.js`
- `tests/unit/live-tracker-retry-queue.test.js`
- `tests/unit/live-tracker-start-over.test.js`
- `tests/unit/live-tracker-opponent-stats.test.js`

## Test Updates
- New retry-queue regression coverage.
- Existing queue, start-over, and opponent stat tests rerun.
- Full `tests/unit` suite rerun.

## Risks
- Queue removal must target the exact replayed entry.
- Harness tests can break when `live-tracker.js` import wiring changes.
