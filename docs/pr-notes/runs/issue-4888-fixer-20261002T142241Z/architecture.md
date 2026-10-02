# Architecture — Issue #4888

## Root cause

Upcoming discovery uses `drainOrderedPages`, but leased recovery uses an unordered, unlimited collection-group read. Lease growth can therefore create unbounded reads and worker input. Deduplication is coupled to the eager snapshot instead of a cross-page invariant.

## Design

- Keep `processReminderDoc` and all claim, marker, effects-boundary, release, finalization, and retry code unchanged.
- Replace the eager leased snapshot with `drainOrderedPages` over `reminderDeliveryClaimExpiresAtMillis`, using an explicit limit and document-snapshot cursor. The existing single-field collection-group index supports this query.
- Drain leased recovery before upcoming discovery. Ascending expiry order prioritizes the oldest recovery work; upcoming discovery can then return the same due-window documents, and the shared full-path set suppresses repeat processing.
- Filter and register unseen paths synchronously before invoking concurrency-limited workers.
- Use one invocation-wide runtime deadline. Each population keeps its page cap so an upcoming backlog cannot suppress recovery.
- Emit leased, upcoming, and aggregate summaries. Aggregate examined count is the unique path-set size; aggregate sent/failed counts come from worker outcomes. Overall stop precedence is runtime cap, then page cap, then drained.

## Cursor safety

Passing a document snapshot to `startAfter` preserves deterministic tie-breaking by document identity when expiry values match. Mutating or removing the lease field during processing does not invalidate the already-materialized cursor values.

## Recurrence risk

Medium: dual-query pagination, mutation during recovery, and shared runtime accounting are easy to regress without later-page and effect-count assertions.
