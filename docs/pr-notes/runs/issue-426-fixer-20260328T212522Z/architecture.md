Decision: Fix the publisher, not the consumer.

Why:
- `js/live-game-state.js` already applies negative `stat` deltas correctly.
- `js/live-tracker.js` already emits reverse `stat` events on undo/remove.
- `track-live.html` is the inconsistent producer.

Evidence:
- `track-live.html` broadcasts `type: 'undo'` with updated score.
- `track-live.html` does not emit a second `type: 'stat'` event with a negative value in the undo/remove path.
- The live-game viewer updates score from event payload fields, which explains why score changes but player stat sections remain stale.

Control equivalence:
- Preserves the existing live event model.
- Avoids introducing new event types or replay semantics.
- Keeps downstream consumers aligned with the already-working mobile tracker contract.
