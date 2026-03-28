Thinking level: medium
Reason: small change, but it touches a live and replay shared ingestion path.

Implementation plan:
1. Add a pure helper for viewer event ingestion to `js/live-game-state.js`.
2. Write focused Vitest coverage for `clock_sync`-only and mixed-event sequences.
3. Wire `processNewEvents(...)` to use the helper.
4. Run targeted tests and commit a minimal patch referencing #345.
