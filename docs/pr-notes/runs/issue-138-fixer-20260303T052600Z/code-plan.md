# Code Role Output

## Patch Plan
1. Add a unit regression test reading `edit-schedule.html` and asserting local formatting helper usage for practice edit prefill.
2. Replace the two UTC prefill assignments in `startEditPractice` with `formatIsoForInput(...)`.
3. Run targeted vitest command for new test.

## Code Changes Applied
Planned minimal patch only in `edit-schedule.html` plus one unit test file.

## Validation Run
- `node node_modules/vitest/vitest.mjs run tests/unit/edit-schedule-practice-timezone.test.js`

## Residual Risks
- Runtime behavior still depends on browser `datetime-local` local-time semantics by design.

## Commit Message Draft
Fix practice edit datetime-local timezone drift (#138)
