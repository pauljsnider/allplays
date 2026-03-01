# Architecture Role Summary

## Decision
Keep recurrence expansion centralized in `expandRecurrence`; normalize `untilBoundary` with a deterministic precedence:
1. UTC-midnight date-only normalization
2. Local-midnight normalization

## Why
Date-input persistence path emits UTC-midnight timestamps in non-UTC zones. Prioritizing UTC-midnight normalization directly encodes that source behavior and prevents accidental exclusion of last-day occurrences.

## Controls Equivalence
- No new data access, no auth/rules changes.
- No schema changes.
- Behavior change constrained to end-boundary computation.

## Rollback Plan
Revert this commit; boundary logic returns to prior ordering.
