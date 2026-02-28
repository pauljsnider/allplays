# Code Role Notes

## Minimal Patch Plan
1. Add shared helper to parse/validate `GMT` shortOffset parts.
2. Require two-digit hours in shortOffset detection and parsing.
3. Preserve existing fallback behavior for unsupported formats.
4. Extend tests for non-padded offset fallback and adjust canonical shortOffset fixtures.

## Files
- `js/utils.js`
- `tests/unit/ics-timezone-parse.test.js`
