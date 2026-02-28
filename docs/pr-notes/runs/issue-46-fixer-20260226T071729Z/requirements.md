# Requirements Role Synthesis (fallback, no sessions_spawn available)

## Objective
Fix ICS TZID parsing so synced event time is accurate for users in different browser timezones.

## User-facing requirement
- For `DTSTART;TZID=America/New_York:20260310T180000`, event instant must represent 6:00 PM in America/New_York.
- Display should remain local-viewer converted (`toLocaleTimeString`) from correct instant.

## Non-goals
- No broad ICS RFC expansion beyond TZID-aware date-time parsing for common IANA zones.
- No calendar UI redesign.

## Acceptance
- TZID event imported in non-matching browser timezone renders shifted correctly (e.g., ET 6:00 PM => PT 3:00 PM).
- Existing UTC (`...Z`) and floating/all-day behavior remains stable.
