# Architecture Role Synthesis

## Current state
`parseICS` returns exactly one object per VEVENT and drops recurrence metadata.

## Proposed state
Implement recurrence expansion inside `parseICS`:
- Parse and store RRULE + EXDATE while reading VEVENT.
- At `END:VEVENT`, emit either single event (no RRULE) or expanded occurrences.
- Support minimal safe RFC5545 subset needed for issue:
  - `FREQ=DAILY|WEEKLY`
  - `COUNT`, `UNTIL`, `INTERVAL`, `BYDAY` (for weekly)
  - `EXDATE` exclusions

## Constraints
- Avoid introducing new dependencies.
- Keep existing event shape so consumers remain unchanged.
- Preserve DTSTART/DTEND TZ handling already implemented.

## Conflict resolution
- Requirements lane suggested broad recurrence support; code lane suggested narrow support.
- Decision: implement targeted DAILY/WEEKLY + COUNT/UNTIL/INTERVAL/BYDAY now, because it fixes issue scope with minimal complexity and low regression risk.
