# Requirements Role Notes

## Objective
Fix resume-state restoration so mixed `liveEvents` datasets do not ignore newest untimestamped events.

## User Impact
- Prevents resuming to stale period/clock after reload/offline transitions while `serverTimestamp()` is pending.
- Preserves continuity for coaches/parents/managers rejoining active games.

## Acceptance Criteria
1. In mixed timestamped + untimestamped `liveEvents`, untimestamped events that occur after the latest timestamped event can drive restored period/clock.
2. Existing behavior remains for all-timestamped and all-untimestamped datasets.
3. Unit tests cover mixed-dataset recency behavior and pass.
