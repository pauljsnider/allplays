# Architecture Role Summary

## Risk Surface
`expandRecurrence` drives generated practice instances; incorrect cadence affects scheduling, RSVPs, and calendar exports.

## Design Decision
Replace day-delta week computation with week-start day-number computation:
- `weekStartDayNumber = dayNumber - getDay()`
- `weeksSinceSeriesStart = (currentWeekStart - seriesStartWeekStart) / 7`

## Control Equivalence
Keeps DST-safe calendar arithmetic via `Date.UTC(y, m, d)` day numbers; narrows blast radius to weekly interval gating only.

## Rollback
Single-function revert in `js/utils.js` plus test revert in `tests/unit/recurrence-interval.test.js`.
