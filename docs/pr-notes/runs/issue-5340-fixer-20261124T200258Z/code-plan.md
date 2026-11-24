# Code plan

1. Retain the existing application-wide branch.
2. Add a `firebase-function` discriminator and expected target schema.
3. Add exact artifact-SHA and deployment-ID evidence shapes.
4. Validate schema/status/project/target, then compare one supported identity.
5. Reject unknown types and mixed shapes.
6. Add focused regressions and run the nearest Vitest file.

Root cause: the global application-only schema made individual evidence unrepresentable. Prevention: every evidence shape needs explicit positive, malformed, unsupported, target-mismatch, and identity-mismatch tests.

The requested `allplays-code-expert` skill was unavailable; the fallback role produced the equivalent minimal patch plan.
