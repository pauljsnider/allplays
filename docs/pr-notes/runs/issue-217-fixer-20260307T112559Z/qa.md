Test strategy:
- Add Vitest unit coverage for pure bracket helper behavior:
  - pool-seed label resolution
  - winner propagation into downstream games
  - unresolved/tie-safe placeholders
  - patch generation only when resolved state changes
- Add source-based tests for `edit-schedule.html` to verify tournament fields are present and saved into `gameData`.
- Add source-based tests for `track-live.html` to verify tournament advancement recomputation is invoked on game completion.

Manual validation:
1. In `edit-schedule.html`, select `Tournament` and confirm bracket fields appear.
2. Save a tournament game with slot-source metadata, reopen edit mode, and verify fields persist.
3. Finalize an upstream tournament game in `track-live.html` and verify downstream tournament game docs receive updated `tournament.resolved` values.

Regression guardrails:
- Existing generic schedule flows must continue to save non-tournament games without tournament metadata.
- Existing unit suites for standings and live-game helpers should still pass.
