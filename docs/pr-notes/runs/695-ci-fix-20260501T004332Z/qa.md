# QA Notes

## QA Plan
- Run the focused regression: `npx vitest run tests/unit/game-plan-switching.test.js`.
- Run the CI-equivalent unit suite: `npm run test:unit:ci`.

## Coverage
- Verifies loading a game without a saved plan resets lineups and drag/drop transient state.
- Verifies saving after switching does not carry stale lineup payload.
- Verifies shared projected games disable save.
