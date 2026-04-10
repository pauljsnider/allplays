Test focus:
- Login module import version changes are static and should be verified by source inspection.
- Auth state manager needs a regression test covering authenticated -> null transition during processing.

Planned validation:
- Run the existing `tests/unit/login-page.test.js` suite with Vitest.
- Confirm the new test fails against the old behavior and passes with the fix.
