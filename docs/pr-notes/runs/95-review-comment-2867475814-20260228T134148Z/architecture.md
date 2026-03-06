# Architecture Role Notes

## Decision
Normalize recurrence interval calculations to a single temporal frame (UTC) to remove mixed-frame math.

## Why
- Existing logic used UTC day numbers with local weekday boundaries, creating edge-case cadence drift.
- UTC alignment matches existing `isoDate` generation via `toISOString()` and recurrence comparisons.

## Control Equivalence
- No reduction in access control, data segregation, or auditability.
- Pure deterministic logic correction in client-side expansion.

## Rollback
- Revert commit touching `js/utils.js` recurrence block if any downstream cadence regressions appear.

## Instrumentation
- Validate with deterministic node checks across default timezone and `TZ=America/Chicago`.
