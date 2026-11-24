# QA analysis

Use one canonical valid fixture and mutate one invariant per negative case.

Coverage matrix:

- valid current application-wide Functions evidence;
- missing evidence and missing required fields;
- non-object evidence, invalid field types, empty identities, and malformed SHA values;
- unsupported schema versions, target types, or states;
- project, deploy-target, deploy-label, or artifact mismatches;
- unsupported updated, unchanged, partial/quota, retry, individual-function, or Hosting metadata.

Smallest validation command:

```sh
npx vitest run tests/unit/verify-firebase-application-deployment.test.js --reporter=verbose
```

Prevention rule: each supported evidence shape needs one complete positive fixture plus omission, type, unsupported-value, and cross-identity mismatch tests for every field used in acceptance.
