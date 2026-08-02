## What changed

- <!-- Summarize the user-visible change and root cause. -->

## Validation

- Exact tested head SHA: <!-- SHA -->
- Focused regression command/result: <!-- command and result -->
- Broader checks: <!-- unit, app, rules, build, smoke -->

## Mutation safety

- [ ] Not applicable, or external/provider effects have durable ownership, stable idempotency, validated responses, and compensating cleanup.
- [ ] Not applicable, or tests cover concurrent calls and provider success followed by local persistence failure.
- [ ] Not applicable, or stored and fresh navigation/payment destinations use the same fail-closed validation policy.
- [ ] Not applicable, or image uploads use the same authenticated project and scoped path contract on web and native, with path-builder plus Storage rules-engine coverage.
- [ ] Not applicable, or multi-stage UI errors identify whether upload, provider work, or local persistence failed.

## Production handoff

- [ ] Firestore rules are unchanged, or rules-engine coverage and coupled Functions/Hosting behavior are included.
- [ ] Merge is not described as deployed until the exact merge SHA passes `deploy-prod`, its release marker, and `post-deploy-smoke`.
