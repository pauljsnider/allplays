# Architecture Role Summary

## Current State
`expandRecurringICSEvent` advanced instants using browser-local date math, which can drift TZID event wall time around DST.

## Proposed State
- Persist `recurrenceTimeZone` from `DTSTART` TZID metadata.
- Introduce timezone-aware recurrence helpers that:
  - compute weekday/day-number in the recurrence timezone
  - advance day steps by wall-clock in that timezone
  - gracefully fall back to existing local stepping if timezone resolution fails

## Decisions
- Keep recurrence expansion bounded by occurrence count (`MAX_ICS_RECURRENCE_OCCURRENCES`) not by fixed-year hard stops.
- Keep EXDATE filtering as authoritative; no fallback base-event reinsert.

## Risk Surface
- Blast radius limited to ICS recurrence expansion path in `js/utils.js`.
- Main regression risk is weekday cadence drift; covered by recurrence interval tests.
