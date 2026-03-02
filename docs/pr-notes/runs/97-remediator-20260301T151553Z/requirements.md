# Requirements Role Notes

## Objective
Address PR thread `PRRT_kwDOQe-T585xVPRU` by ensuring resume state derivation handles mixed timestamped/untimestamped `liveEvents` without restoring stale context.

## Current State
`deriveResumeClockState` uses timestamp ordering when all events have timestamps, and progression heuristics otherwise. The review indicates a mixed-data case where latest event can be untimestamped (`createdAt: null`) and should not be ignored.

## Proposed State
When dataset is mixed, include untimestamped events as valid candidates for recency/progression so the most recent context is restored even while server timestamps are pending.

## Constraints
- Keep change minimal and scoped to resume derivation.
- Preserve existing behavior for all-timestamped and all-untimestamped datasets.

## Success Criteria
- Mixed dataset with latest untimestamped event restores that latest event.
- Existing unit tests pass; add/adjust regression coverage for mixed case.
