# TanStack Query Spike: Parent Home And Schedule Summary

## Scope

This spike compares the existing `appDataCache` pattern with TanStack Query for the read-only parent Home and schedule-summary path. It intentionally does not migrate writes, subscriptions, payments, or schedule detail mutations.

## Current App Data Cache

`appDataCache` is lightweight and already integrated with the app service layer. It gives the Home page predictable cache keys, explicit invalidation, and no new runtime dependency. The tradeoff is that retry, stale data, request deduping, and load-state conventions stay hand-rolled by each page or helper.

For parent Home, the current approach is acceptable for low churn reads, but it keeps page code responsible for coordinating primary load, secondary hydration, partial failure handling, and retry messaging.

## TanStack Query Fit

TanStack Query would improve four things for this workflow:

- Request deduping: concurrent Home and schedule-summary consumers can share the same in-flight query.
- Stale data: `staleTime` and background refresh can keep Home responsive while schedule summaries update.
- Retries: transient network failures can use a consistent retry policy instead of page-local `try/catch` branches.
- Migration cost: the app would need provider setup, query-key conventions, and a bridge from legacy service errors into query error states.

## Minimal Proof Of Concept

A bounded proof of concept should wrap the existing parent Home read behind a query descriptor rather than replacing the service:

```ts
export const parentHomeSummaryQuery = (userId: string) => ({
  queryKey: ['parent-home-summary', userId],
  staleTime: 60_000,
  retry: 1,
  queryFn: () => loadParentHomeSummary({ uid: userId })
});
```

The important part is the shape: stable query key, conservative `staleTime`, one retry, and no change to the legacy service contract. Schedule summary can follow the same pattern with `['schedule-summary', userId, teamScopeKey]`.

## Recommendation

Defer a full TanStack Query migration until the shared async operation work in #2031 settles. Proceed only with a small adapter proof of concept in a future PR if it can reuse the existing Home service contract and typed app errors.

The near-term recommendation is to keep `appDataCache` for production Home reads and standardize page load/error behavior first. TanStack Query remains promising for read-heavy workflows, but introducing it before the shared async layer converges would create two competing cache/error abstractions.

## Coordination With #2031

#2031 should own the app-wide load-state and retry conventions. A later TanStack Query pilot should adapt to that outcome rather than bypassing it. The next safe step is a feature-flagged read-only query wrapper for parent Home after #2031 defines the service error contract.
