# Architecture

## Current State
`scheduleRetry` snapshots `liveState.eventQueue`, clears the in-memory queue, and persists an empty queue before replay completes. A reload or crash during that async resend window can permanently drop unsent events.

## Proposed State
Keep the pending queue intact until each replayed event succeeds. Remove and persist entries one-by-one after successful `broadcastLiveEvent` calls. Stop the replay loop on the first failure so remaining events stay queued in order.

## Architecture Decisions
- Fix stays inside `js/live-tracker.js` retry handling.
- Persisted queue remains the source of truth for unsent events.
- Successful sends prune the matching queued event immediately.
- Retry stops on first failure to preserve event ordering and prevent later events from leapfrogging earlier failures.

## Risks
- Retry behavior changes from best-effort replay of the full snapshot to ordered replay with early stop on failure.
- Queue mutation during retry must not remove unrelated newly queued events.

## Rollback
Revert the `scheduleRetry`/queue-removal change and the new retry regression test if unexpected duplicate-send behavior appears.
