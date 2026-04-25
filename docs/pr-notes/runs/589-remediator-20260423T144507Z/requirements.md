# Requirements

## Acceptance Criteria
- If `restoreLiveEventQueue(teamId, gameId)` restores one or more queued live events during init, retry delivery must be scheduled automatically without waiting for a new broadcast failure.
- Queued live events must remain in memory and persisted storage until each specific event has been successfully rebroadcast.
- A failed retry must leave the failed event and all later events queued for a future retry attempt.
- Empty queue state must remove the persisted storage entry.

## Edge Cases
- Page reload during retry processing must preserve any unconfirmed queued events.
- New failed broadcasts appended while a retry loop is running must not be lost.
- Retry scheduling should stay single-flight via the existing `retryTimeout` guard.

## Constraints
- Keep changes limited to `js/live-tracker.js`.
- No unrelated refactor.
- Validation is manual only per repo guidance.
