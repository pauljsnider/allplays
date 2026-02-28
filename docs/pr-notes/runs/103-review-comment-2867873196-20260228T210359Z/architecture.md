# Architecture Role Notes

## Current state
`parseICSDate` correctly rejects unresolved timezone lookups, but malformed `TZID` values that sanitize to empty can still flow into floating-time fallback.

## Proposed state
Fail closed when raw `TZID` is supplied but normalizes to an empty string.

## Control impact
- Blast radius: isolated to ICS import datetime parsing in `js/utils.js`.
- Backward compatibility: unchanged for true floating times with no `TZID` parameter.
- Auditability: warning includes raw `TZID` token and source datetime.
