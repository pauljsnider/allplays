## Objective

Honor explicit `game-day.html?teamId=...&gameId=...` links for completed games without changing the normal Game Day auto-selection order.

## Current State

- `pickBestGameId()` rejects requested games when they are cancelled, completed, or stale beyond the grace window.
- `edit-schedule.html` still renders `Command Center` links for non-cancelled completed games.
- Clicking a completed game's direct link can be rerouted to a different live or upcoming game.

## Proposed State

- Treat an explicitly requested completed game as a valid direct-link target.
- Keep auto-selection behavior unchanged when no explicit completed game was requested.

## Risk Surface

- Blast radius is limited to Game Day entry routing.
- A wrong change could make stale scheduled games override live/upcoming fallback selection.
- No auth, tenant isolation, or data-write behavior changes.

## Assumptions

- Cancelled games should still never be honored.
- Explicit completed-game links are intentional and should open Wrap-Up context for that game.
