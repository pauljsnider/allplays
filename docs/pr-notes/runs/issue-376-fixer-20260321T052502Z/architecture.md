Architecture decision:
- Add a small pure helper module for post-game stat editor state and payload normalization.
- Add a dedicated Firestore helper for absolute `aggregatedStats` writes on completed games.
- Wire a lightweight editor panel directly into `game.html`.

Why this path:
- Keeps the feature isolated from live-tracker logic.
- Makes the data model testable without browser or Firebase integration.
- Preserves existing reporting reads because the stored shape remains `aggregatedStats`.

Data model:
- `aggregatedStats/{playerId}` keeps `playerName`, `playerNumber`, `stats`, and `timeMs`.
- Add `didNotPlay: true|false` for completed-game corrections.

Controls equivalence:
- Write access stays behind existing full team access checks already used for summary and stat-sheet edits.
- No new cross-team or parent write surface is introduced.

Rollback:
- Remove the `game.html` editor wiring and stop writing `didNotPlay`; existing reads still work with historical docs.
