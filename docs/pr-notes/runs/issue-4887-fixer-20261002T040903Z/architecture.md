# Architecture analysis

> The requested `allplays-architecture-expert` skill was unavailable, so the role applied the specified senior Firebase architecture perspective directly.

## Design

Reuse `drainOrderedPages` and `runReminderWorkers` from `functions/pre-event-reminder-dispatcher-core.cjs`. Configure fee-specific aliases for page size, page cap, runtime cap, and a fixed worker concurrency of five.

The upcoming query retains its predicates and adds `orderBy('dueDate')`, `limit(pageSize)`, and snapshot-based `startAfter(cursor)`. A document snapshot supplies Firestore's document-key tiebreaker for equal due dates. Pages run sequentially, and each page uses one fixed worker pool.

The existing per-document flow remains intact: lease recovery, threshold lookup, recipient resolution, claim acquisition, post-claim eligibility/payment/player-link checks, preference/access filtering, sent marker, effects boundary, delivery, and claim cleanup. Because the worker helper counts rejected workers instead of propagating them, retain the first retryable error externally and rethrow it after selected work settles.

The leased query remains unchanged. Preserve its existing overlap suppression by path after upcoming documents are examined.

## Observability and risk

Emit a structured upcoming summary with pages attempted, stopping reason, examined, sent, and failed counts before propagating a retryable failure. The main risks are swallowing retryable failures, cursor skips for equal due dates, and multiplying concurrency; external error capture, snapshot cursors, sequential pages, and one named worker limit address them.
