# QA analysis

The requested `allplays-qa-expert` skill was unavailable, and the required role subagent failed with `published reply runtime missing for main`. This fallback analysis applies the requested senior QA role.

## Regression guard

The workflow contract test asserts that:

- the targeted retry-enabled Functions deploy exists;
- evidence verification appears immediately afterward and before migrations, the full application deploy, and component markers;
- neither the deploy-to-verifier edge nor the verifier-to-next-step edge suppresses failure;
- the verifier and adapter are copied into and digest-pinned inside the trusted production handoff.

A pre-fix run failed because the verification call was absent. The smallest validation is:

`npx vitest run tests/unit/firebase-deploy-workload-identity.test.js --reporter=verbose`

Direct parser checks should cover a complete mixed update/unchanged log and confirm a missing terminal target exits nonzero; broader exit-zero partial-deployment regression coverage remains the separate #5403 slice.
