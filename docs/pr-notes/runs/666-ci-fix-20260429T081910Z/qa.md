# QA Notes

## Root Cause
`tests/unit/live-game-replay-init.test.js` rewrites imports from `js/live-game.js` before executing it with `AsyncFunction`. The harness expected the old `live-game-video.js?v=2` import and old symbol list, so the newer v3 import remained partially unreplaced and produced invalid destructuring syntax.

## QA Plan
- Run the focused failing test: `npx vitest run tests/unit/live-game-replay-init.test.js --reporter=verbose`.
- Run the full CI-equivalent unit command: `npm run test:unit:ci`.
