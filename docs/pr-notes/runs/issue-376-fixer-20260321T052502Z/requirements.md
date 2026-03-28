Objective: add a completed-game post-game stat editing workflow on `game.html` for full-access users.

Current state:
- Completed games render aggregated player stats and summary controls.
- No per-player correction flow exists after a game is finished.

Proposed state:
- Full-access users can open an `Edit Stats` panel from `game.html`.
- The panel supports player-by-player editing, `Did not play`, and `Save`, `Save and Next`, `Save and Previous`.

Assumptions:
- Aggregated per-game stats in `teams/{teamId}/games/{gameId}/aggregatedStats/{playerId}` are the canonical source for reports, player rollups, and leaderboards.
- A zeroed stat line plus explicit `didNotPlay` metadata is sufficient for downstream views.

Risk surface and blast radius:
- Changes are limited to completed-game report UI, one Firestore write helper, and a pure helper module.
- No live tracker flow is modified.

Recommendation:
- Reuse the game's resolved stat tracker config to render editable fields.
- Persist absolute stat values for a player doc instead of trying to replay live event increments.

Success measures:
- Full-access users can edit stat lines on completed games.
- `Did not play` persists and survives page reload.
- Game report table updates immediately after save.
