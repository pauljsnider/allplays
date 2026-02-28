# Architecture Role Notes

## Current State
`supportsShortOffsetTimeZoneName()` uses a permissive regex and `getTimeZoneOffsetMinutes()` parses `GMT` offsets with 1-2 digit hours.

## Proposed State
Centralize offset parsing in `parseShortOffsetZonePart(zonePart, { requireTwoDigitHours: true })` and use it in both support detection and runtime parsing.

## Design Decision
- Treat non-canonical shortOffset output as unsupported for this fast path.
- Fall back to the existing wall-clock component-diff algorithm for correctness.

## Control Equivalence
- Fallback path already handles TZ math and DST transitions; parser hardening narrows acceptance without widening privileges or data exposure.
