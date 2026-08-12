## Risk Matrix

- **High — hidden-post authorization/list bounds:** A permissive rule can restore unbounded reads or expose another user’s private hide history. Blast radius includes every authenticated user.
- **High — candidate filtering correctness:** Missing a candidate-scoped lookup can resurface a viewer-hidden post; treating a failed lookup as “not hidden” is also unsafe.
- **High — scan-budget enforcement:** Paging until 30 visible posts without a hard total candidate ceiling can recreate latency and read amplification when many recent candidates are hidden.
- **Medium — web/native parity:** Browser Firestore queries and native REST `runQuery` paths can diverge; both must use bounded candidate IDs and avoid collection pagination.
- **Medium — cache/chunk behavior:** Duplicate candidates from visible-user and team queries can cause repeat reads unless one per-load cache is shared across all query branches.
- **Medium — newest-first/backfill behavior:** Filtering a full recent page must still allow bounded paging to older visible candidates while preserving sort order and the 30-post cap.
- **Low — Home/FriendProfile presentation:** Returned model shape and UI behavior should remain unchanged; component suites mock `socialService`, so they guard rendering but cannot prove Firestore read bounds.
- **Coverage gap:** Existing component tests cannot observe Firestore request counts. The service suite and rules emulator suite are the meaningful automated seams for this fix; request logging remains a manual/emulator check.

## Automated Tests To Add/Update

1. Replace the unbounded-history social-service regression with a fixture containing more than 200 historical hides. Assert only candidate IDs are queried, the matching candidate stays excluded, unrelated history is not scanned, and no hide-history cursor loop occurs.
2. Verify candidate IDs are split at the configured query limit and every hidden-post query carries the approved limit.
3. Verify overlapping candidate IDs across visible-user and team branches are looked up once per load, while a second top-level load gets a fresh cache.
4. Make every bounded candidate hidden and assert post reads stop at the documented shared total candidate budget and the result remains retryable/partial.
5. Verify a hidden first page causes bounded paging to older visible posts, preserving descending order and the 30-post cap on feed and friend profile.
6. Reject a hide-query chunk and assert unresolved candidates fail closed and produce a retryable partial-feed/profile error.
7. Verify native REST never uses the paginated hidden-post collection endpoint and uses bounded `IN` queries containing only candidate document references.
8. Add a static rules contract asserting separate owner-only `get` and bounded owner-only `list`, with the former broad `allow read` absent.
9. Add emulator coverage for owner get and bounded candidate list success, plus unbounded, oversized, cross-user, and unauthenticated denial.
10. Keep Home and FriendProfile presentation suites green. Add component coverage only if the returned model or partial/error contract changes.

## Manual Test Plan

1. Seed at least 250 historical hides, including recent candidate matches and unrelated records.
2. Open Home Social Feed on mobile and confirm prompt render, matching hides excluded, older visible posts newest-first, and at most 30 posts.
3. Open an accepted friend profile and confirm the same bounded behavior.
4. Use a multi-team viewer and verify overlapping feed candidates render once and are checked once per load.
5. Confirm admin status does not expose another user's private hide history.
6. Hide a visible post, refresh both surfaces, and confirm persistence without pruning historical records.
7. Exhaust the candidate budget and confirm retryable partial state rather than authoritative emptiness.

## Negative Tests

- Empty candidate sets issue zero hide queries.
- Exact chunk and chunk-plus-one boundaries produce one and two queries respectively.
- Duplicate candidates do not consume extra budget or reads.
- Non-candidate historical hides are never requested.
- Failed hide chunks do not expose unresolved candidates.
- Full pages cannot exceed the fixed candidate ceiling.
- Unbounded, invalid-limit, oversized, unauthenticated, and cross-user lists fail.
- Existing hide writes, global moderation, friendship authorization, reactions, ranking, and 30-item limits remain unchanged.

## Release Gates

1. `npx vitest run tests/unit/app-social-service.test.js --reporter=verbose`
2. `firebase emulators:exec --only firestore --project demo-allplays "npx vitest run tests/unit/app-social-rules.test.js --reporter=verbose --no-file-parallelism"`
3. `npm run test:app -- src/pages/Home.test.tsx src/pages/FriendProfile.test.tsx`
4. `npm run app:build`
5. Rules and client changes land together; failed rules activation blocks publishing.
6. GitHub CI remains the full gate. No native build or broad smoke suite is required locally for this shared-service/rules change.

## Post-Deploy Checks

1. Confirm exact merge SHA deployment and post-deploy smoke success.
2. Exercise both surfaces with more than 200 hides on mobile.
3. Confirm matching hides remain excluded, ordering is unchanged, and at most 30 posts render.
4. Review request logs for no history enumeration and candidate totals below the documented ceiling.
5. Watch latency, Firestore reads, permission denials, partial-feed errors, and timeouts.
6. Roll back on any hidden-post resurfacing, cross-user access, unbounded-list success, or material partial-error increase.
