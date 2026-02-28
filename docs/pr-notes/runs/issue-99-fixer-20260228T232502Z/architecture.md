# Architecture Role (allplays-architecture-expert)

## Root Cause
`expandRecurrence` compares full datetime `current` (inherits series start clock time) against `until` parsed at date midnight. On the `until` day, non-midnight starts are greater than midnight and break early.

## Minimal Safe Fix
- Normalize end-condition comparison to calendar day granularity.
- Compute an inclusive boundary at end-of-day local time for `until` and keep existing recurrence stepping logic.

## Blast Radius
- Limited to recurrence expansion in `js/utils.js`.
- Consumers (`edit-schedule.html`, `calendar.html`) benefit without page-level changes.

## Controls
- Add targeted unit regression test against `expandRecurrence`.
- Keep patch localized to end-condition comparison only.
