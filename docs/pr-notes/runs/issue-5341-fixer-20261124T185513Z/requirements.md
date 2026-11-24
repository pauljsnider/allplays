# Requirements analysis

Issue #5341 is a narrow evidence-classification slice for the production Firebase application deploy. Validation must accept only application-wide Firebase Functions evidence that declares the canonical current state and binds every deployment identity field to the expected deployment.

Required behavior:

- Accept one supported application-wide Functions target with complete current evidence.
- Require exact project, deploy-target, deploy-label, and artifact identities.
- Reject absent, non-object, incomplete, malformed, unsupported, or mismatched evidence.
- Keep individual function targets, updated or unchanged states, partial/quota metadata, retry metadata, Hosting completion, and workflow gating out of scope.

Root cause: no deterministic schema or validation path currently exists for this production target, so neither valid current evidence nor invalid variants can be classified safely.
