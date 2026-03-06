# Requirements Role Summary

Thinking level: medium (targeted regression with user-visible schedule impact).

## Objective
Prevent wrong game times when ICS TZID conversion cannot deterministically resolve DST boundary offsets.

## Current vs Proposed
- Current: Non-converging TZID offset iteration logs a warning but still returns a timestamp.
- Proposed: Non-converging TZID offset iteration returns `null` so the event is dropped fail-closed.

## Risk Surface and Blast Radius
- Surface: ICS import path only (`parseDateTimeInTimeZone` in `js/utils.js`).
- Blast radius reduced: invalid/non-deterministic timezone conversions no longer propagate into schedules/tracking.

## Assumptions
- Dropping ambiguous events is preferable to importing wrong timestamps.
- Existing warning logs are sufficient for troubleshooting import failures.

## Success Criteria
- Oscillating/non-converging TZID offsets produce no imported event.
- Existing valid TZID, UTC, and numeric-offset parsing remains green.
