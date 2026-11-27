# QA analysis

## Regression strategy

- Keep the existing multi-target complete-evidence success test.
- Add a first-attempt `evidence: []` test and assert the structured incomplete-target error code.
- Assert all intended target names appear in expected order, preventing generic cardinality errors and first-match-only diagnostics.
- Keep the test at the verifier API seam because production workflow changes are out of scope.

## Focused validation

```bash
npx vitest run tests/unit/verify-firebase-application-deployment.test.js --reporter=verbose
```
