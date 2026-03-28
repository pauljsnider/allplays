## Coverage Plan

- Add a unit test for live-game selection with mixed schedule data.
- Add a unit test proving a stale requested id does not override the nearest valid upcoming game.
- Add a unit test for URL normalization using a mocked `history.replaceState`.
- Add a wiring assertion that `game-day.html` consumes the shared helper and still loads `getGame(teamId, resolvedGameId)`.

## Regression Focus

- Requested id handling for completed, cancelled, practice, and stale scheduled events.
- Browser history rewrites for resolved Game Day URLs.
- No change to access control, rendering, or downstream data subscriptions.

## Validation

- Run the new focused Vitest file first to observe failure.
- Implement the helper and page wiring.
- Re-run the focused test file, then the full unit suite if runtime permits.
