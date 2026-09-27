## Patch Plan

- Replace eager hidden-history pagination with a per-load candidate-hide resolver.
- Use one documented 120-ID candidate budget per surface and a 10-ID hide-query chunk shared with Firestore rules.
- Share the resolver through every Home branch so overlapping candidates reuse cached in-flight results and consume budget once.
- Resolve hide state page-by-page, continuing to older candidates until 30 visible posts, source exhaustion, or budget exhaustion.
- Apply the same resolver to Friend Profile.
- Fail closed on unresolved chunks, retain verified visible posts, and mark results partial/retryable.
- Preserve newest-first ordering, the 30-post limit, friendship authorization, reactions, and durable hide writes.

## Code Changes Applied

Planned only; the role made no edits.

- Export `documentId` from `legacySocialDb.ts`.
- Add candidate resolver, web `documentId in`, native `__name__ IN`, cache, budget, and failure behavior in `socialService.ts`.
- Split hidden-post rules into owner get and owner list with a positive limit no greater than 10.
- Replace history-scan tests with candidate-scoped, chunking, deduplication, budget, backfill, failure, native parity, and rules-engine regressions.

## Validation Run

- `npx vitest run tests/unit/app-social-service.test.js --reporter=verbose`
- `firebase emulators:exec --only firestore --project demo-allplays "npx vitest run tests/unit/app-social-rules.test.js --reporter=verbose --no-file-parallelism"`
- `npm run test:app -- src/pages/Home.test.tsx src/pages/FriendProfile.test.tsx`
- `npm run app:build`

No validation was run by the planning-only role.

## Residual Risks

- Rules can bound owner queries but cannot prove IDs came from candidates.
- Parallel feed branches require synchronous budget reservation before I/O.
- Native document-reference formatting must exactly match Firestore `__name__ IN` requirements.
- Failed chunks must not cache unresolved IDs as visible.
- Rules and client changes must deploy together.

## Commit Message Draft

`Bound social hide lookups for issue #4598`
