# QA Notes

## Acceptance criteria
- Importing modules that transitively initialize Firebase in Vitest node environment no longer throws `ReferenceError: window is not defined`.
- Existing browser global config resolution remains intact.
- Bundled Firebase fallback tests continue to pass.

## Validation plan
- Run `npm test -- --run tests/unit/team-pass.test.js tests/unit/firebase-runtime-config.test.js` for the affected import path and runtime config behavior.
- If time permits, run full `npm test -- --runInBand` equivalent is not available for Vitest, so use `npm test`.
