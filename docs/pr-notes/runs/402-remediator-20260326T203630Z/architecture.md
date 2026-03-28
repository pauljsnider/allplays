## Current State

- `game-day.html` calls `pickBestGameId(games, gameId)` before loading the selected game.
- The helper currently uses one gate for all requested games, so completed requests are rejected before fallback selection runs.

## Proposed State

- Preserve the current helper shape and fallback ordering.
- Narrowly adjust requested-id validation so completed games are honored only when explicitly requested.

## Controls Comparison

- Current blast radius: direct links to completed games can silently land on the wrong matchup.
- Proposed blast radius: explicit completed links work again while automatic routing still prefers live/upcoming games.
- No page flow, URL format, or Firestore read-path changes.
