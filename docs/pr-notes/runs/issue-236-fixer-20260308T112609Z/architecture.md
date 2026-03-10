Decision: implement schedule mirroring in the existing Firestore team-game model instead of introducing a new organization domain in this patch.

Why:
- Lowest blast radius: changes stay inside `js/db.js` game CRUD paths already used by schedule and tracker flows.
- Preserves current permissions and data segregation: each team still owns its own `teams/{teamId}/games/{gameId}` document.
- Gives the user-visible outcome that matters most for this issue: once a placeholder opponent is replaced with a linked real team, both teams see the same fixture and later result updates.

Design:
- Add pure helper functions to build mirrored game payloads and sync metadata.
- Store lightweight shared schedule identifiers on both game documents so future updates know the counterpart doc.
- Mirror only schedule-safe fields plus score/status fields; do not mirror tracker internals or summaries.
- Keep placeholders as plain `opponent` text until a real linked opponent team is selected.

Risk surface:
- `addGame`, `updateGame`, `deleteGame`, and `cancelGame` now have shared-game side effects for linked fixtures only.
- Score fields must be swapped for the mirrored team perspective.
- Failure mode is contained to linked schedule sync; the source team save should still succeed.
