## Acceptance Criteria

- Home and Friend Profile perform no whole-history hidden-post scan.
- Hide reads contain only encountered candidate IDs, in chunks no larger than 10.
- One per-load cache deduplicates overlapping candidates.
- One shared per-load candidate ceiling is 120 unique IDs on each surface.
- Unverified candidates fail closed and produce partial/retryable state.
- Hidden candidates remain excluded regardless of historical hide count; older visible posts continue newest-first; rendered output remains capped at 30.
- Rules allow owner get and bounded owner list, while denying unbounded, oversized, unauthenticated, and cross-user access.

## Architecture Decisions

- Preserve existing post query fan-out and page budgets; move hide filtering inside candidate-page processing.
- Use Firestore exact document-ID `in` queries for web and equivalent `__name__ IN` reference queries for native, chunked at 10 for cross-runtime compatibility.
- Cache in-flight promises before I/O. Cache scope is one top-level surface load.
- Rules enforce owner and request-size boundaries. Service tests enforce candidate scoping because rules cannot inspect query predicates directly.

## QA Plan

- First write failing service regressions for candidate-only queries, >200 unrelated hides, chunking, duplicate reuse, older visible posts, budget exhaustion, and native parity.
- Add static and emulator rules regressions for get/list boundaries.
- Run focused service tests, focused rules emulator tests, unchanged Home/FriendProfile component tests, and the React production build.

## Implementation Plan

1. Add `documentId` to the typed adapter and test mock.
2. Add candidate lookup context and web/native exact-ID chunk loaders.
3. Integrate candidate checks into both post-page loaders.
4. Create surface-scoped contexts in Home and Friend Profile and remove history scans.
5. Split rules and add rules-engine coverage.
6. Validate, record RCA learning, and commit.

## Risks And Rollback

- Risk: unresolved hide checks resurface private viewer choices. Mitigation: fail closed and mark partial.
- Risk: concurrent feed branches duplicate reads. Mitigation: reserve cache entries synchronously before requests.
- Risk: native reference values are malformed. Mitigation: assert exact structured-query bodies in unit tests.
- Risk: new list rules break valid clients. Mitigation: keep owner get, permit positive limits through 30, and land rules/client together.
- Rollback is the single commit. No schema or data migration is involved.

## Conflict Resolution

- Requirements recommended one shared budget across Home branches. Architecture proposed 504 to preserve the full existing branch fan-out, while Code proposed 120. The synthesis chooses 120 because it covers four complete 30-post pages, imposes a materially smaller cost ceiling, and meets the issue's focused scaling objective.
- Architecture proposed 30-ID query chunks based on current SDK support. Code proposed 10 for the smallest supported web/native boundary. The synthesis chooses 10 and binds the same value in rules and tests.
- Rules cannot enforce `documentId in`; the approved control equivalence is owner-only bounded list in rules plus exact candidate-query regressions in the client.
