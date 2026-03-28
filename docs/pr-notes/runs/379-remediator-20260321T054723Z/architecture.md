Current state vs proposed state:
- Current: `loadGame()` derives table columns once and passes a rerender callback that only rebuilds table rows.
- Proposed: centralize header/body rendering behind one local `renderStatsTable()` helper that recalculates columns and minutes visibility from the updated in-memory maps on each save.

Risk surface:
- Limited to completed-game report rendering and the post-game correction payload.
- No Firestore schema change.
- Blast radius stays inside `game.html` and `js/post-game-stat-editor.js`.

Controls:
- Keep `formatMMSS()` at script scope.
- Preserve existing editor wiring and DB write path.
- Cover changed behavior with focused unit assertions for payload time clearing and fouls-column discovery.
