# Architecture analysis

Implement a pure validator in `scripts/verify-firebase-application-deployment.mjs`. Keep the contract explicit and fail closed: exact schema version, target type, state, and deployment identity fields; no coercion, defaulting, substring matching, or ambient environment reads.

The supported target is the application deploy invoked in production as `retry_firebase_deploy "hosting,functions" "application"`. This slice verifies the Functions evidence attached to that application target; it does not claim that Hosting completed.

Return a small normalized classification only after every invariant passes. Reject unknown fields so later evidence states cannot accidentally become accepted before their own review and regression coverage.

Recurrence risk is medium until the contract is centralized. The durable rule is to add schema literals, identity invariants, and negative mutation tests together whenever a new deployment evidence form is introduced.
