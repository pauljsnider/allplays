# Requirements Role Analysis

## Objective
Ensure ICS events with timezone metadata (TZID and numeric offsets) are imported and tracked using the true event instant, regardless of viewer browser timezone.

## User-visible acceptance criteria
- Calendar events using `DTSTART;TZID=America/New_York:20260310T180000` render at the correct local viewer time for that instant.
- Calendar events using offset forms (e.g. `20260310T180000-0500`) render correctly.
- Tracking a synced event stores the same instant represented by the ICS event, not browser-local reinterpretation.
- Existing UTC `Z` and date-only ICS behavior remains intact.

## Risk and blast radius
- Risk surface: calendar import + schedule display + Track flow persisted game date.
- Blast radius: imported schedule cards and downstream reminders/workflows using `games/{gameId}.date`.
- Primary failure to avoid: accidental regressions for existing `Z`-suffixed events.

## Assumptions
- Recurrence handling is out of scope for this issue.
- Date-only ICS values should continue to be interpreted as local date (existing behavior).
- IANA TZID values are common and must be respected.

## Recommendation
Use timezone-aware parsing in `parseICS` for datetime values while keeping the rest of the event object contract unchanged.
