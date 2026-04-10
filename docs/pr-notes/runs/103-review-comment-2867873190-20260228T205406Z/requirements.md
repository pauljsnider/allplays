# Requirements Role Notes

## Objective
Address PR #103 review feedback that `timeZoneName: 'shortOffset'` may fail on older browsers and regress TZID ICS parsing.

## Current State
- `getTimeZoneOffsetMinutes()` first attempts `Intl.DateTimeFormat(... timeZoneName: 'shortOffset')`.
- Existing fallback computes offset via wall-clock component diff.
- Existing tests cover a non-throwing unsupported behavior (`EDT` returned instead of offset).

## Proposed State
- Add one-time support probe for `shortOffset` and skip that path when unsupported.
- Keep wall-clock component diff as compatibility-safe fallback.
- Add explicit test for unsupported runtime that throws `RangeError`.

## Acceptance Criteria
- TZID parsing remains correct for `America/New_York` sample event.
- Runtime without `shortOffset` still parses TZID datetime without reverting to local browser time.
- No regression to UTC (`Z`) or numeric offset parsing behavior.

## Risk Surface / Blast Radius
- Scope limited to timezone offset helper used by ICS parsing.
- No schema/API changes.
- Failure mode remains fail-closed (`null` date dropped with warning) for unresolvable TZID.

## Assumptions
- Browser supports `Intl.DateTimeFormat` with `timeZone` option.
- Existing wall-clock fallback remains valid across target browsers.
