## What changed

- <!-- Summarize the user-visible change and root cause. -->

## Validation

- Exact tested head SHA: <!-- SHA -->
- Focused regression command/result: <!-- command and result -->
- Broader checks: <!-- unit, app, rules, build, smoke -->

## Mutation safety

- [ ] Not applicable, or external/provider effects have durable ownership, a persisted exact request, stable idempotency, validated responses, and compensating cleanup only after a definitive local non-commit.
- [ ] Not applicable, or tests cover concurrent calls, uncertain provider responses, provider success with pre-commit failure, and provider success with post-commit response failure.
- [ ] Not applicable, or shared provider effects are serialized across every authorized principal without returning one principal's request, customer data, capability, or checkout URL to another principal; same-principal and different-principal concurrency are both tested.
- [ ] Not applicable, or stored and fresh navigation/payment destinations use the same fail-closed validation policy.
- [ ] Not applicable, or every production caller of a changed upload helper was inventoried; each legacy/React/native persistence surface atomically saves URL + cleanup path, preserves ambiguous writes, survives account deletion, and has path-builder plus Storage rules-engine coverage for another authorized admin's replacement.
- [ ] Not applicable, or every production consumer in the full `db.js` → `auth.js` → `utils.js` dependency chain uses the same incremented cache version for each changed shared module and the cache-bust guard passes.
- [ ] Not applicable, or multi-stage UI errors identify whether upload, provider work, or local persistence failed.

## Production handoff

- [ ] Firestore rules are unchanged, or rules-engine coverage and coupled Functions/Hosting behavior are included.
- [ ] Merge is not described as deployed until the exact merge SHA passes `deploy-prod`, its release marker, and `post-deploy-smoke`.
