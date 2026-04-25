# Architecture

## Current State
- Init restores `liveState.eventQueue` from `localStorage` but does not trigger `scheduleRetry()`.
- `scheduleRetry()` copies the queue, clears `liveState.eventQueue`, and persists the empty state before replaying items.
- A crash or reload during replay can drop unconfirmed events.

## Proposed State
- After restore, immediately call `scheduleRetry()` when the queue is non-empty.
- Process retries from the head of `liveState.eventQueue` in place.
- Remove and persist only after a successful rebroadcast of the current head event.
- On first failure, stop processing, leave the remaining queue persisted, increment backoff, and reschedule.

## Risks
- New events appended during retry must not be overwritten.
- Multiple retry timers must remain prevented by the existing guard.

## Recommendation
- Implement the smallest safe change inside `restoreLiveEventQueue()` and `scheduleRetry()` only.
- Preserve existing exponential backoff behavior and queue persistence contract.
