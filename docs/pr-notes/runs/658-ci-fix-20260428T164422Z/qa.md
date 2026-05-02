# QA Notes

## Failing Checks
- unit-tests [deploy-preview]
- unit-tests [ci]

## Root Cause To Validate
The edit-team unit tests are pinned to stale import strings. `team-management-access-wiring.test.js` expects `team-access.js?v=1`; `edit-team-admin-access-persistence.test.js` extracts the inline module script but fails to replace the current `db.js` and `team-access.js` imports, leaving ESM import syntax inside `AsyncFunction`.

## Validation Plan
Run the two affected test files directly:

```bash
npx vitest run tests/unit/team-management-access-wiring.test.js tests/unit/edit-team-admin-access-persistence.test.js
```

If clean, run the CI unit command:

```bash
npm run test:unit:ci
```
