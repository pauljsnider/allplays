# QA Plan

## Highest Risks

1. Search still reaches schedule construction and performs per-team event reads.
2. Parent or zero-event staff teams disappear.
3. Access and visibility filtering, caching, or query bounds regress.

## Automated Coverage

- Extend `tests/unit/app-search-service.test.js` with a multi-team fixture proving search calls the scope-only source, never calls `loadParentHomeSummary`, preserves eligible teams, and retains cache reuse.
- Extend `apps/app/src/lib/homeService.test.ts` to prove parent plus zero-event staff teams are projected and `loadParentSchedule` is never called.
- Retain existing direct-admin, stream-volunteer, inactive filtering, metadata fallback, public limit, player budget, hydration retry, query replacement, dialog close, and stale-result tests.

## Focused Gates

1. `npx vitest run tests/unit/app-search-service.test.js --reporter=verbose`
2. `npm run test:app -- src/lib/homeService.test.ts`
3. Run the exact failing test command first if a focused gate fails.

## Manual Gap

Emulator/request-counter verification of zero game and practice list reads is appropriate for smoke validation but not required for this local focused patch because the service boundary is mocked directly.
