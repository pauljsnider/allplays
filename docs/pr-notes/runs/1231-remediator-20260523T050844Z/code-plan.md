# Code Plan

The code-planning subagent timed out, so this inline implementation plan is used.

1. Inspect `js/team-fees-admin.js` and existing unit tests.
2. Update `escapeCsvValue()` to prefix an apostrophe when the first non-whitespace character is one of `=`, `+`, `-`, `@`, or `|`.
3. Preserve current null handling and CSV quoting behavior.
4. Add focused unit tests for formula markers, whitespace bypasses, pipe markers, safe values, and combined sanitization plus escaping.
5. Run the affected unit test command available in the repo.
