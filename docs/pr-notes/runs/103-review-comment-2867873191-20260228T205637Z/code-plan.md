# Code Role Plan

## Minimal Patch
1. Add clarifying comment in `js/utils.js` near `shortOffset` sign parse to document `local - UTC` convention.
2. Extend `tests/unit/ics-timezone-parse.test.js` with a `+0500` numeric offset assertion.
3. Run targeted Vitest file and confirm all tests pass.

## Conflict Resolution
- Review suggestion proposed sign inversion (`+ => -1`) in helper parsing.
- Existing implementation aligns with conversion math and existing tests; inversion would regress TZID conversions.
- Decision: keep arithmetic, increase explicitness and coverage.
