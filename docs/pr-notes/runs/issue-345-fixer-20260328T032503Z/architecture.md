Objective: isolate the spectator event-ingest branch that owns `clock_sync` behavior.

Current state:
- `processNewEvents(...)` in `js/live-game.js` mixes state mutation, DOM rendering, celebrations, and feed suppression.

Proposed state:
- Add a pure helper in `js/live-game-state.js` that applies one viewer event to state and reports what follow-up rendering is needed.
- Keep `processNewEvents(...)` responsible for DOM effects and subscriptions only.

Blast radius:
- `js/live-game.js`
- `js/live-game-state.js`
- one new unit test file

Controls:
- Preserve reset and lineup handling semantics
- Preserve scoreboard updates for all event types
- Preserve no-feed behavior for `clock_sync`

Rollback:
- Revert the helper wiring commit; behavior returns to previous inline branch
