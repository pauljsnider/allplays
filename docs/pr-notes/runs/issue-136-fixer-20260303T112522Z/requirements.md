# Requirements Role Synthesis

## Objective
Ensure recurring ICS calendar events appear as individual upcoming occurrences in schedule/calendar views.

## User-facing requirement
- Given an ICS VEVENT with `RRULE` recurrence metadata, users must see all expanded upcoming occurrences, not only the master DTSTART instance.
- Respect cancellation exceptions where present (`EXDATE`) so excluded dates are not shown.

## Acceptance criteria
- A weekly RRULE with `COUNT=4` produces 4 occurrences in parser output.
- Occurrence entries preserve summary/location/UID context and remain classifiable as game/practice.
- Existing non-recurring ICS events and timezone parsing behavior remain unchanged.

## Risk surface
- Parsing layer only (`js/utils.js`) with read-only downstream consumers.
- Blast radius is all ICS feeds loaded across schedule/calendar pages.
