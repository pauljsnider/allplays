# QA Role Notes

## Test Focus
1. Numeric ICS offsets parse correctly for valid values (e.g., `+0500`, `-0430`).
2. Invalid numeric offsets are rejected (existing guard in `parseICSDate`).
3. TZID parsing still works when `shortOffset` is unavailable (existing fallback path).
4. `GMT` parsing rejects impossible offsets (new guard).

## Validation Plan
- Run static syntax check on `js/utils.js`.
- Manual spot-check by reviewing conversion equations and guards in touched functions.

## Risks
- No automated test harness exists; confidence relies on static check + targeted code inspection.
