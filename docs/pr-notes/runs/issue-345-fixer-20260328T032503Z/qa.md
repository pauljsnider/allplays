Coverage target: spectator live-game event ingestion for `clock_sync`.

Regression checks:
- `clock_sync` updates scoreboard fields and does not append to `state.events`
- `clock_sync` does not produce play-feed items in a mixed event stream
- normal scoring events still append and still update stats/scoreboard

Why this is enough:
- The production bug surface is the event-ingest branch, not the DOM markup itself
- A pure helper test is stable and deterministic
- Replay inherits the same branch because replay windows feed into `processNewEvents(...)`

Validation plan:
- Run the new focused unit file first
- Run the broader live-game-related unit suite if available and fast enough
