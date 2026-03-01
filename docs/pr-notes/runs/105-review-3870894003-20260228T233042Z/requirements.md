# Requirements Role Summary

## Objective
Ensure recurring practices include the user-selected final `until` date across timezones, especially parent/coach schedule edits that store date-only values through Firestore `Timestamp`.

## Current State
`expandRecurrence` only extends `until` to end-of-day when local time is midnight. Date-only values parsed as UTC midnight in non-UTC locales become non-midnight local times and terminate recurrence one day early.

## Proposed State
Treat both local-midnight and UTC-midnight `until` values as date-only inputs and normalize to local end-of-day boundary before recurrence cutoff checks.

## Risk Surface
- Affects recurrence expansion for schedule rendering.
- Blast radius limited to series with `recurrence.until`.
- No auth/data-write path changes.

## Acceptance Criteria
- Daily recurrence with `until` from UTC date-only parse includes expected final local day.
- Existing inclusive behavior for local-midnight values remains unchanged.
