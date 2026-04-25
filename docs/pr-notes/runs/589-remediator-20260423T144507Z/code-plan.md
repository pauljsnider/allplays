# Code Plan

## Files
- `js/live-tracker.js`

## Patch Plan
- Update `restoreLiveEventQueue()` to schedule a retry immediately when restored queue length is non-zero.
- Rework `scheduleRetry()` to process the persisted queue in place.
- Remove each event from the queue only after `broadcastLiveEvent()` succeeds, then persist the remaining queue.
- On retry failure, leave the current and remaining events persisted and reschedule with backoff.

## Validation
- Run a syntax check on `js/live-tracker.js`.
- Review diff to confirm changes stay scoped to retry restoration/persistence.
