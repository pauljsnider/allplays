# Architecture analysis

## Decision

Add an exported `drainOrderedPages` primitive beside `drainDueReminderPages`. Keep the existing helper unchanged because pre-event, registration-payment, and team-media dispatchers rely on its raw results, runtime cap, and error semantics.

## Proposed API

`drainOrderedPages({ loadPage, processPage, pageSize, maxPages, initialCursor })`

- `loadPage({ cursor, limit, pageNumber })` returns `{ docs, nextCursor }`.
- `processPage(docs, context)` returns explicit `{ sentCount, failedCount }` deltas.
- The helper returns `pagesAttempted`, `examinedCount`, `sentCount`, `failedCount`, `stoppedBecause`, and `lastCursor`.

Opaque cursors come only from page results. Positive-integer bounds are validated. Exceptions propagate so callers retain retry control.

## Risk

Changing the existing drain would conflate unlike callback result shapes and could alter three unrelated dispatchers. The additive primitive isolates the new contract.
