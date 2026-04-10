Test objective: prove stale game-plan state does not survive a game switch and is not persisted by save.

Primary regression scenarios:
1. Load a game with a saved lineup, then switch to a game with no `gamePlan`; expect empty lineups and no carried-over assignment chips.
2. After the switch, save the unsaved game; expect `updateGame` payload to exclude the prior game's lineup keys and player ids.

Coverage approach:
- Use Vitest and the repo's inline-page extraction pattern to evaluate `loadGame` and the save click handler from `game-plan.html`.
- Stub minimal DOM elements and page dependencies needed by these flows.

Validation commands:
- `npm test -- tests/unit/game-plan-switching.test.js` is not supported by this repo script shape, so run direct Vitest commands instead.
- `node ./node_modules/vitest/vitest.mjs run tests/unit/game-plan-switching.test.js`
- `node ./node_modules/vitest/vitest.mjs run tests/unit/game-plan-interop.test.js`

Exit criteria:
- New regression test fails before the fix and passes after the fix.
- Adjacent existing Game Plan helper test still passes.
