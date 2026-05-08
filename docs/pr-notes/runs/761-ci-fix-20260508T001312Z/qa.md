# QA note

Acceptance criteria:
- `tests/unit/team-schedule-events.test.js` no longer throws `ReferenceError`.
- Existing schedule normalization assertions still pass.
- Full unit test suite passes because the failing CI checks run `vitest run tests/unit`.

Validation:
- Run the targeted unit test.
- Run full `npm test` before commit.
