# Code Role Plan

## Implementation Plan
1. Capture TZID metadata at `DTSTART` parse time for recurrence context.
2. Add timezone-aware helpers for day stepping, weekday matching, and week-anchor day math.
3. Route DAILY/WEEKLY recurrence cursor progression through timezone-aware stepping.
4. Add regression tests for DST wall-time preservation, EXDATE-empty series, and long-interval COUNT expansion.

## Conflict Resolution
- Requirements demanded minimal patch scope; architecture suggested timezone metadata propagation. Resolved by adding one lightweight event field (`recurrenceTimeZone`) consumed only by recurrence expansion.
- QA requested explicit regression guards for all three comments; implemented all three in one test module.

## Rollback
- Revert commit affecting `js/utils.js` and `tests/unit/ics-recurrence-parse.test.js` if recurrence regressions appear.
