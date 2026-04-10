Current state vs proposed state:
- Current: `UTILS_STUB` is serialized as a template literal that the browser loads as a JavaScript module during the Playwright test.
- Proposed: keep the same helper API, but use the correct number of backslashes for regex literals and `RegExp` constructor strings inside that template literal.

Controls and blast radius:
- No production module changes.
- No data model, auth, or network behavior changes.
- Failure mode remains limited to this test if the stub stops matching cancelled event summaries correctly.

Rollback:
- Revert the single-file test change if it causes unexpected smoke-test behavior.
