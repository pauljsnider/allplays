## Coverage Plan

- Update unit coverage for `pickBestGameId()` to prove an explicit completed game id is honored.
- Keep a regression test showing stale scheduled requests still fall back to the nearest valid upcoming game.

## Validation

- Run `npm test -- tests/unit/game-day-entry.test.js`.
- If that passes cleanly, rely on the focused unit coverage because the change is isolated to one helper module.
