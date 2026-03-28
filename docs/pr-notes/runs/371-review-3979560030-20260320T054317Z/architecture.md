## Architecture role

- Decision: preserve the current PR implementation and repair the regression guardrail around the cache-busted import string.
- Current state: `edit-schedule.html` imports `schedule-csv-import.js?v=2`.
- Proposed state: `tests/unit/edit-schedule-csv-import-wiring.test.js` asserts the same import version so the test matches shipped behavior.
- Blast radius: test-only change, no runtime or Firebase path changes, no tenant or PHI exposure change.
- Controls: branch remains auditable via one small commit scoped to the stale assertion.
