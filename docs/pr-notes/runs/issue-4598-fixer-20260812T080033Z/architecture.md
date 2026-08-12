## 1. Current-State Read

- `loadVisibleSocialPostsWithState` and `loadFriendProfile` eagerly load hidden-post history before querying candidates.
- The current scan reads up to three 200-document pages per surface and withholds posts when more history exists.
- Web uses collection pagination; native uses the REST collection-list endpoint. Neither scopes reads to candidate IDs.
- Existing post pagination admits at most 504 candidate occurrences on Home (`4 × 30` main plus `8 × 4 × 12` team) and 120 on Friend Profile (`4 × 30`).
- Firestore rules conflate owner `get` and `list`, allowing owner list requests without a limit.

## 2. Proposed Design

- Replace whole-history loading with one per-surface candidate lookup context.
- Store viewer UID, an in-flight `Map` of candidate ID to authoritative hide state, and a unique-candidate admission counter.
- Document and enforce shared per-load ceilings of 504 unique Home candidates and 120 Friend Profile candidates. These match existing bounded discovery fan-out and are independent of hide-history size.
- For each fetched post page, deduplicate IDs, reserve uncached IDs against the shared budget, query admitted IDs in chunks of at most 30, exclude existing hide records, and continue existing bounded pagination until the visible limit, source exhaustion, or candidate ceiling.
- Web queries `users/{uid}/hiddenSocialPosts` using `where(documentId(), 'in', chunk)` plus `limit(30)`.
- Native posts a structured query beneath `users/{uid}` against `hiddenSocialPosts`, filtering `__name__ IN` full document references and using `limit: 30`.
- Cache promises before network requests so overlapping concurrent branches reuse in-flight results. Discard the cache after each top-level load.
- Budget exhaustion or hide-query failure must fail closed for unchecked candidates and mark the surface partial.

## 3. Files And Modules Touched

- `apps/app/src/lib/socialService.ts`
- `apps/app/src/lib/adapters/legacySocialDb.ts`
- `firestore.rules`
- `tests/unit/app-social-service.test.js`
- `tests/unit/app-social-rules.test.js`
- Home/FriendProfile component tests only if the model contract changes.

## 4. Data/State Impacts

- No schema migration, retention change, or hide deletion.
- Existing hide documents remain authoritative and durable.
- Hide writes and viewer-local semantics remain unchanged.
- Historical hide count no longer affects load cost or completeness.
- Ranking remains newest-first and rendered output remains capped at 30.
- Duplicate candidates consume one cache entry and one lookup per load.

## 5. Security/Permissions Impacts

- Split rules into owner-only `get` and owner-only bounded `list` with a positive limit no greater than 30.
- Preserve all existing verified-owner write restrictions.
- Rules cannot directly require a `documentId in` predicate. They enforce owner scope and per-request bounds; client candidate scoping and aggregate ceilings are locked by service regressions.
- Admin status does not broaden access to another user's private hide collection.

## 6. Failure Modes And Mitigations

- Hide lookup failure never means visible. Unchecked candidates are excluded and the surface is partial/retryable.
- Budget exhaustion stops new admissions, preserves verified visible posts, and marks partial.
- Concurrent duplicates share promises inserted before awaiting Firestore.
- Empty successful exact-ID queries authoritatively classify all queried IDs as visible.
- Web/native chunk sizes, budgets, reference construction, and failure semantics receive equivalent tests.
- IDs are deduplicated and empty values removed; empty or oversized `in` queries are never issued.
- Repeated bounded calls cannot be aggregated by Firestore rules, but remain owner-only; the application ceiling prevents normal-client history scans.
