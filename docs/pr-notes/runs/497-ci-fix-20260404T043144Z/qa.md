Root cause under test: `live-game.js` now imports `renderOpponentStatsCards`, but the replay init test still matches the prior exact import string, leaving an `import` statement in the generated source and causing `AsyncFunction` to fail parse.

Validation plan:
- Run `vitest` for `tests/unit/live-game-replay-init.test.js`.
- Confirm the file parses and replay-specific assertions still pass.

Blast radius: unit-test fixture only. No user-facing behavior or Firebase integration changes.
