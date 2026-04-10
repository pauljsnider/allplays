Decision: fix the viewer contract in a small pure helper, then call it from `live-game.js`.

Why:
- The bug boundary is not tracker persistence.
- Existing tests already validate tracker-side hydration and event ingestion.
- A helper in `live-game-state.js` keeps alias mapping and fallback `FLS` injection in one place without changing generic lineup columns.

Current state:
- `normalizeLiveStatColumns()` normalizes configured labels only.
- `renderStats()` in `live-game.js` renders opponent stats directly from `state.statColumns`.
- If fouls are persisted but the config omits a fouls label, the viewer omits the foul stat entirely.

Proposed state:
- Add a viewer-specific opponent column resolver that appends `FLS` once when opponent stats exist and no foul alias is configured.
- Add a pure HTML renderer for opponent cards so the contract is unit-testable.

Blast radius:
- `js/live-game-state.js`
- `js/live-game.js`
- new unit test coverage only
