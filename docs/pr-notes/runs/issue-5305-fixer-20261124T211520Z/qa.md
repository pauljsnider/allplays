# QA analysis

Add focused regression coverage that fails before the fix and proves:

- updated evidence is accepted for distinct expected function targets only when
  project, target, artifact SHA, and deployment ID all match;
- every updated-evidence field is required;
- malformed schema, status, project, target, SHA, and deployment ID fail;
- unsupported states and extra fields fail;
- mismatched project, target, SHA, and deployment ID fail;
- all existing current-evidence tests remain unchanged and green.

Run only the nearest Vitest file:
`npx vitest run tests/unit/verify-firebase-application-deployment.test.js --reporter=verbose`.

The requested QA skill was unavailable, and the spawned QA lane failed before
analysis because its reply runtime was missing. This artifact records the
main-run fallback synthesis.
