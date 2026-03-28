Objective: Add regression coverage for spectator `clock_sync` handling so late joiners get fresh scoreboard state without fake play cards in live or replay.

Current state: `js/live-game.js` special-cases `clock_sync` inline inside `processNewEvents(...)`, but that branch is not directly unit-tested.
Proposed state: move the viewer event-ingest transition behind a small pure helper and cover it with targeted Vitest cases.

Risk surface:
- Live spectator scoreboard freshness
- Play-by-play feed noise in live mode
- Replay feed noise because replay also uses `processNewEvents(...)`

Assumptions:
- `clock_sync` events are never intended to create play-feed cards
- Existing rendering behavior for normal stat events must remain unchanged
- A narrow helper extraction is acceptable as the minimal safe change

Recommendation: add focused unit tests around the ingest helper and wire `live-game.js` through that helper so the production path remains covered.

Success:
- `clock_sync` updates score, period, and clock
- `state.events` ignores `clock_sync`
- mixed scoring plus `clock_sync` sequences preserve only real plays in the feed path
