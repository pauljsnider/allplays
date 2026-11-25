# QA analysis

The requested `allplays-qa-expert` skill was unavailable, and the required role
subagent failed with `published reply runtime missing for main`. This fallback
analysis applies the requested senior QA and regression-guardrail role.

## Focused regressions

1. Model a quota-pressure partial deployment whose evidence contains a terminal
   result for one intended function but omits another. Assert validation throws
   even though the simulated deployment outcome itself has no nonzero-exit
   signal.
2. Assert the error code is stable and metadata is exactly
   `{ incompleteTargets: [...] }` in intended-target order.
3. Serialize the metadata and assert it contains no project ID, artifact SHA,
   deployment resource ID, or deployment-internal field names.
4. Supply identity-only `current` evidence for an intended target and assert the
   same incomplete-target classification.
5. Supply terminal `updated` and `unchanged` evidence for every intended target
   and assert aggregate validation succeeds in intended-target order.

The smallest relevant validation is:

`npx vitest run tests/unit/verify-firebase-application-deployment.test.js --reporter=verbose`
