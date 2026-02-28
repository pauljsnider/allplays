# Architecture Role Synthesis (fallback, no sessions_spawn available)

## Current state
`parseICS` strips parameters from fields (`field.split(';')[0]`) and passes only raw value to `parseICSDate`. `parseICSDate` interprets non-`Z` timestamps in browser-local timezone.

## Proposed state
Preserve ICS field params for DTSTART/DTEND and pass optional TZID into `parseICSDate(value, tzid)`. Add a helper that converts a local date-time in a named IANA timezone to an absolute JS `Date` instant.

## Minimal patch plan
1. Parse params from `field` and extract `TZID`.
2. Extend `parseICSDate` signature with optional timezone.
3. If TZID exists and value has time and is not `Z`, compute UTC instant via Intl.DateTimeFormat timezone projection loop.
4. Fallback to previous local behavior if TZID missing/invalid.

## Risk surface and blast radius
- Blast radius limited to ICS parsing in `js/utils.js`.
- Potential regressions: all-day dates, UTC (`Z`) values, malformed TZID strings.
- Mitigation: add focused unit tests for TZID, UTC, and floating local values.
