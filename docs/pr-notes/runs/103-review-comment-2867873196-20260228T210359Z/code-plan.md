# Code Role Notes

## Minimal patch
1. In `parseICSDate`, detect when raw `params.TZID` exists but sanitized timezone ID is empty.
2. Emit explicit warning and return `null`.
3. Add focused unit test asserting event drop + warning for malformed TZID.

## Non-goals
- No changes to successful TZID conversion logic.
- No changes to floating/local-time semantics when `TZID` is absent.
