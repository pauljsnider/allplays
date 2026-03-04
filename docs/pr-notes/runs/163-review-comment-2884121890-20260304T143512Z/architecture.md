# Architecture Role Summary

## Current state
- `expandRecurrence` computes `seriesStartWeekStartDayNumber` from `seriesStart`.
- When old series are expanded, cursor is moved to `windowStart` with original time-of-day.
- Weekly cadence matching uses `weeksSinceSeriesStart` derived from the same series week anchor.

## Risk surface
- Any mismatch between pre-loop skip alignment and per-day interval checks can produce off-cadence weekdays.
- Blast radius is schedule rendering and downstream RSVP state for recurring practices.

## Decision
- Preserve implementation in `js/utils.js` (already anchored correctly at PR head).
- Add explicit regression test to lock the long-running biweekly multi-day case.

## Control equivalence
- No data model or auth/rules changes.
- Behavioral contract tightened with deterministic unit coverage.
