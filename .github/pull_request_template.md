## What changed

- <!-- Summarize the user-visible change and root cause. -->

## Validation

- Exact tested head SHA: <!-- SHA -->
- Focused regression command/result: <!-- command and result -->
- Broader checks: <!-- unit, app, rules, build, smoke -->

## Mutation safety

- [ ] Not applicable, or external/provider effects have durable ownership, a persisted exact request, stable idempotency, validated responses, and compensating cleanup only after a definitive local non-commit.
- [ ] Not applicable, or tests cover concurrent calls, uncertain provider responses, provider success with pre-commit failure, and provider success with post-commit response failure.
- [ ] Not applicable, or stored and fresh navigation/payment destinations use the same fail-closed validation policy.
- [ ] Not applicable, or image uploads use the same authenticated project and final owner-scoped path on web/native, persist the cleanup path, survive account deletion, and have path-builder plus Storage rules-engine coverage for another authorized admin's replacement.
- [ ] Not applicable, or every production consumer of a changed `js/db.js` uses the same incremented cache version and the cache-bust guard passes.
- [ ] Not applicable, or multi-stage UI errors identify whether upload, provider work, or local persistence failed.

## Production handoff

- [ ] Firestore rules are unchanged, or rules-engine coverage and coupled Functions/Hosting behavior are included.
- [ ] Merge is not described as deployed until the exact merge SHA passes `deploy-prod`, its release marker, and `post-deploy-smoke`.
