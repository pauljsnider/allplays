# QA Role Notes

## Regression Guardrails
- Keep existing tests for unsupported/RangeError `shortOffset` behavior.
- Add explicit test for non-zero-padded `GMT-5` returning correct parsed datetime via fallback.
- Update oscillating offset test to canonical `GMT-04`/`GMT-05` so it still exercises shortOffset path.

## Validation Scope
- Targeted unit test file: `tests/unit/ics-timezone-parse.test.js`.
- Lightweight runtime sanity check using Node import of `parseICS`.
