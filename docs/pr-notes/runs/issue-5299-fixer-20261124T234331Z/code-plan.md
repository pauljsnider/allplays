# Code Plan — Issue #5299

The requested `allplays-code-expert` skill was unavailable, so this artifact records the equivalent implementation review.

## Minimal patch

1. Dispatch to an aggregate helper when either public input is an array.
2. Require both inputs to be non-empty arrays.
3. Validate and uniquely index intended deployments by `projectId` plus `functionTarget`.
4. Require each evidence entry to have a unique matching target identity.
5. Delegate every matched pair to `verifyFunctionDeployment`.
6. Reject missing, unexpected, duplicate, malformed, or unsupported evidence.
7. Return a frozen result array in intended-target order.

## Tests

- Accept mixed current, updated, and unchanged evidence supplied out of order.
- Reject a mixed aggregate with one unsupported target.
- Reject missing, duplicate, and unexpected target evidence.
- Keep all existing individual-target tests unchanged.

## Validation

Run `npx vitest run tests/unit/verify-firebase-application-deployment.test.js --reporter=verbose` only.
