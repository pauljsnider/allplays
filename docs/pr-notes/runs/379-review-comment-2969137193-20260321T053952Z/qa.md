Target workflow:
- Open a completed game report with at least one player `timeMs > 0`.
- Verify the player stats table minutes column renders.
- Verify the playing-time insights player rows and summary cards render.

Regression focus:
- No `ReferenceError: formatMMSS is not defined` during `loadGame()`.
- `MM:SS` output unchanged for zero and positive durations.

Validation plan:
- Run unit tests to catch unrelated regressions in nearby report helpers.
- Inspect the final script references so every `formatMMSS()` call resolves from shared scope.

Residual gap:
- No direct automated test covers inline `game.html` script scope.
