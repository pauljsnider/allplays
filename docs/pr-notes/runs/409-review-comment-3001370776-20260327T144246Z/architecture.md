## Architecture Role Summary

- Current state: `processNewEvents()` captured `state.lastResetAt` once per batch, so a later `reset` in the same batch could not tighten filtering for following events.
- Proposed state: compute visible events sequentially against the evolving reset boundary, then hand the filtered ordered list to the existing event application path.
- Blast radius: limited to replay/live event filtering in `js/live-game.js` and pure helper logic in `js/live-game-state.js`.
- Control preserved: no schema changes, no Firestore query changes, and no new mutable global state.
