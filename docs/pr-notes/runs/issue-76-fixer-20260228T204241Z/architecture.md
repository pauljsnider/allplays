# Architecture Role Analysis

## Root cause
`parseICS` discards property parameters by reducing `DTSTART;TZID=...` to `DTSTART`, then `parseICSDate` parses non-`Z` datetimes with `new Date(year, ...)`, treating them as browser-local time.

## Proposed state
- Preserve ICS field parameters for DTSTART/DTEND lines.
- Parse datetimes with one of:
  - UTC (`...Z`) using `Date.UTC`.
  - Numeric offset (`+/-HHMM` or `+/-HH:MM`) by converting to UTC epoch.
  - TZID by converting local components in that zone to a UTC instant via `Intl.DateTimeFormat` offset resolution.
- Keep returned `Date` objects as canonical transport values so existing UI/Firestore code paths remain stable.

## Control equivalence
- No data model changes.
- No API surface changes outside parser internals.
- Existing consumers still receive `Date` objects.

## Minimal patch boundaries
- `js/utils.js` only for parser logic.
- Unit tests under `tests/unit/` for regression coverage.
