# Architecture Role Summary

## Current state
`parseICSDate` attempted timezone resolution and silently fell back to browser-local `Date` when `TZID` conversion failed.
`getTimeZoneOffsetMinutes` depended on `Intl.DateTimeFormat(...timeZoneName='shortOffset')` parsing only.

## Proposed state
- Keep existing UTC and floating-time behavior unchanged.
- Add fail-closed behavior for invalid explicit timezone declarations (`TZID`, malformed numeric offsets).
- Add two-stage timezone offset resolution:
  1. Parse `timeZoneName: 'shortOffset'` when available.
  2. Fallback to wall-clock part differencing (`formatToParts` without `timeZoneName`) for broader browser support.
- Add DST gap round-trip validation: if resolved instant does not render back to the requested wall-clock in target `TZID`, reject.

## Risk and blast radius
- Blast radius limited to ICS import date parsing path in `js/utils.js`.
- Explicit timezone inputs now fail closed instead of silently drifting to local browser timezone.
- Floating local datetime strings (no `TZID`, no offset, no `Z`) preserve previous behavior.
