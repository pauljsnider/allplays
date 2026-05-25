# Code Plan

## Implementation Plan
- In `AppSearchDialog.tsx`, derive `helpResults` from `results.help ?? []` immediately after computing results.
- Replace direct `results.help` dereferences in help status, section items, and section offset math with `helpResults`.
- Update the Playwright smoke search-service shim to omit `help`, preserving the legacy payload shape that triggered the review comment.
- Validate with focused Vitest tests and, if practical, app build/typecheck.
