# Architecture Role Summary

Thinking level: medium (single-function safety behavior change).

## Decision
Fail closed in `parseDateTimeInTimeZone` when iterative timezone resolution does not converge within max iterations.

## Why
Returning the last oscillating candidate can be off by ~1 hour around DST spring-forward gaps. A null return preserves data integrity and keeps downstream UI consistent with trust boundaries.

## Controls Comparison
- Before: Warning-only control, potentially incorrect persisted schedule times.
- After: Warning + hard reject control, no incorrect timestamp emitted.

## Rollback
Revert the single `return null` line if product later prefers best-effort import.

## Instrumentation
Existing console warnings identify non-convergent timezone + wall-clock value for debugging.
