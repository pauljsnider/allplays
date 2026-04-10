Implementation plan:
1. Hoist `formatMMSS()` above `renderPlayerStatsTable()` in `game.html`.
2. Remove the nested duplicate helper from `renderPlayerStatsTable()`.
3. Run targeted validation and confirm the diff only affects shared formatter scope plus required run notes.

Conflict resolution:
- Requirements and architecture both favor the minimal shared-scope fix.
- QA notes the lack of direct inline-script automation coverage, so validation will include targeted unit tests plus explicit source inspection evidence.
