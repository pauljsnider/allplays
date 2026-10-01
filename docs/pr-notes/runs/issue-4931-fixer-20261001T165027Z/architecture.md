# Architecture analysis

> The requested `allplays-architecture-expert` skill was unavailable, so this analysis emulates its senior static-web/Firebase architecture role.

## Design

Add a standalone CommonJS export in `functions/pre-event-reminder-dispatcher-core.cjs` with an object-argument API: `runReminderWorkers({ items, concurrency, worker })`.

- Snapshot input with `Array.from(items || [])`.
- Reuse the existing positive-integer validation and require a function worker.
- Return exact zero counters for empty input.
- Start `Math.min(concurrency, items.length)` async runners.
- Have each runner synchronously claim the next index before awaiting `worker(item, index)`.
- Store results by original index, then derive deterministic counters after all workers fulfill.
- Treat truthy outcomes as sent and keep `failedCount: 0`; propagate rejection.

The fixed runner count is the hard concurrency ceiling, and synchronous index claims prevent duplicate processing. Exporting from the side-effect-free core keeps the helper directly testable without loading Firebase Functions.

## Boundaries

Do not edit or import the helper into `functions/index.js`. Do not alter paging, claims, eligibility, delivery, thresholds, or failure accounting.
