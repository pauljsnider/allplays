# QA analysis

The requested `allplays-qa-expert` skill was unavailable, and the required role
subagent failed before execution with no runtime. This fallback analysis
applies the requested senior QA role.

## Regression guardrails

1. Verify a complete first attempt, then retry the same artifact with unchanged
   target observations and assert the exact first result is preserved.
2. Model a quota-pressure attempt with one missing target, retry with the same
   evidence, and assert both attempts fail with the same error code and exact
   `incompleteTargets` metadata.
3. Ensure retry evidence can fill a gap only with a terminal authoritative
   result; identity-only `current` evidence must remain incomplete.
4. Keep the expected artifact and deployment identities fixed in every retry
   fixture so cross-artifact evidence cannot be reused.

Focused validation:

`npx vitest run tests/unit/verify-firebase-application-deployment.test.js --reporter=verbose`
