# QA Analysis

## Regression scenario

1. Define multiple expected Functions.
2. Model the Firebase deploy process as exiting with status 0.
3. Provide valid updated/unchanged evidence for only a strict subset.
4. Invoke the aggregate application deployment verifier.
5. Assert `firebase-functions-incomplete-targets` and the omitted target.
6. Ensure no success value can be returned.

The fixture must remain syntactically valid so the rejection proves incompleteness rather than parser failure. The existing complete-deployment test remains the positive control.

## Scope guardrails

Do not add Hosting validation, workflow wiring assertions, retry identity behavior, smoke checks, or metadata-format changes.

## Validation

Run `npx vitest run tests/unit/verify-firebase-application-deployment.test.js --reporter=verbose`.

## Recurrence risk

Medium: exit status and semantic deployment completion are easy to conflate.
