# Architecture notes

## Acceptance Criteria
- Stored live tracker finish plans can be replayed into Firestore using the current chunked commit path.
- Test expectations match the intentional commit order: event batches, aggregated stat batches, then the game update batch.

## Architecture Decisions
- `commitFinishPlan` already separates writes to avoid Firestore batch limits: live event writes are committed in event chunks, aggregated stats are committed in stats chunks, and the game document update commits last.
- The failing assertion is stale test drift from the previous single-batch ordering, not a production write bug.

## Risks And Rollback
- Risk is limited to unit-test expectation coverage. No runtime code change is required.
- Rollback is reverting the test expectation change if the product intentionally returns to single-batch or stats-first ordering.
