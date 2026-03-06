# Architecture Role Summary

## Current State
- `parseICSDate` handles numeric offsets directly.
- `getTimeZoneOffsetMinutes` parses `shortOffset` strings (`GMT+/-H[:MM]`) and falls back to wall-clock diff.
- Internal convention is `offsetMinutes = localTime - utcTime`.

## Proposed State
- Preserve existing offset convention because it matches fallback math and downstream conversion.
- Add explicit inline comment at shortOffset parser to reduce future sign confusion.
- Add focused test to prove `+0500` conversion semantics.

## Blast Radius
- Code path touched: ICS timezone parsing helper + unit tests.
- No schema/auth/rules/UI changes.

## Control Check
- Equivalent or stronger controls: yes, stronger via regression test asserting sign convention.
