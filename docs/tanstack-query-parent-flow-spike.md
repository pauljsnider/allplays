# TanStack Query Parent Flow Spike

## Scope

This spike evaluates whether to introduce TanStack Query for the parent Home and Schedule summary flows.

## Current State

- Home primary and secondary loads are already routed through `useAsyncOperation`.
- Schedule summary data is cached through `appDataCache` with explicit cache keys and TTLs.
- Home can warm the first render from `loadParentHomeSummaryBootstrap`, then hydrate chat, fees, RSVP, and social slices without blocking the summary.
- Schedule route resolution can reuse the cached parent schedule summary before falling back to broader team scans.

## Recommendation

Do not add TanStack Query for this slice yet. Keep the current shared async operation and app data cache primitives until the app has at least two more parent-facing flows that need the same stale-while-revalidate, invalidation, and background refetch semantics.

## Why

- The current data dependencies are route-scoped and already have explicit cache keys.
- Adding a query client now would create a second cache to reconcile with `appDataCache`.
- Firebase SDK subscriptions, native REST fallbacks, and partial Home hydration all need custom adapters before they fit a generic query model.
- The performance issue is better served by measuring reads, chunk size, and time-to-first-summary before introducing a new dependency.

## Revisit Criteria

- Home, Schedule, Messages, and Team Detail all need shared background refresh policies.
- Cache invalidation becomes duplicated across three or more services.
- Offline resume behavior requires stale data promotion across routes.
- The bundle budget can absorb the library and provider setup without regressing startup metrics.

## Migration Sketch

1. Introduce a query client at the app shell only after measuring the bundle and startup impact.
2. Wrap one read-only summary query first, likely parent schedule summary.
3. Keep write paths in typed services and invalidate the corresponding query keys after successful writes.
4. Remove overlapping `appDataCache` entries only after equivalent stale-time and force-refresh behavior is proven.
