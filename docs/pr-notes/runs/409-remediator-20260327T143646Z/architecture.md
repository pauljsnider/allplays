Decision: Preserve the existing live-event processing path and add a small replay-only sequential application path for seek rebuilds.

Why:
- The regression is specific to replay seek windows that can contain both pre-reset and reset/post-reset events.
- Sequential application keeps the current `processNewEvents` semantics for live mode while recomputing reset state naturally between batches.

Blast radius:
- Limited to replay seek behavior in `js/live-game.js`.
- No schema, backend, or subscription changes.

Rollback:
- Revert the replay seek helper and restore the prior direct `processNewEvents(replayWindow.events)` call.
