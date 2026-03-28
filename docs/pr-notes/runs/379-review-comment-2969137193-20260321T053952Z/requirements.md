Objective: restore completed-game report rendering when tracked minutes exist.

Current state:
- `game.html` defines `formatMMSS()` inside `renderPlayerStatsTable()`.
- `loadGame()` also uses `formatMMSS()` for the playing-time insights cards.
- Completed games with minute data can throw `ReferenceError` before the playing-time section renders.

Proposed state:
- Keep one shared `formatMMSS()` in script scope so both render paths use the same formatter.

Risk surface and blast radius:
- Affects completed-game reports with tracked playing-time data.
- No Firestore schema, auth, or write-path impact.
- Failure mode is client-side rendering interruption on `game.html`.

Assumptions:
- Existing `MM:SS` formatting behavior is correct and should not change.
- Review intent is to restore behavior with the smallest safe patch.

Recommendation:
- Hoist the helper back to shared scope instead of duplicating formatting logic.

Success measure:
- Completed game reports with `timeMs` render both the player stats table and playing-time insights without `ReferenceError`.
