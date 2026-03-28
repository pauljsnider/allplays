## Requirements Role Summary

- Objective: prevent replay seek from rendering stale pre-reset events after a `reset` event when replay batches are ordered by `gameClockMs`.
- User-visible acceptance: seeking past a reset only shows the reset and events whose `createdAt` is on or after that reset boundary.
- Constraint: keep existing replay ordering, scoreboard reset behavior, and live event dedupe semantics intact.
- Assumption: `createdAt` remains the authoritative reset boundary for stale-event filtering, even when replay ordering is based on `gameClockMs`.
