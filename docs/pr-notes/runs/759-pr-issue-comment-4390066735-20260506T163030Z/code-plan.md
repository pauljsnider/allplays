## Implementation Plan

1. Add `firstNonEmptyObject(...values)` near `asObject()`.
2. Replace the two object-shaped `||` chains for `submitted` and `playerSource` with the helper.
3. Add a focused regression test in `tests/unit/edit-roster-registration-import.test.js`.
4. Validate with focused and full unit tests.

## Conflict Resolution

- Requirements raised a possible merge-all-sources question. Chosen direction is first non-empty fallback only, because it directly fixes the reviewed defect while preserving current precedence and limiting blast radius.
