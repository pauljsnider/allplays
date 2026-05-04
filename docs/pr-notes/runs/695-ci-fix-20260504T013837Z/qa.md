# QA Notes

## QA Plan
- Run the affected unit test file: `npx vitest run tests/unit/game-plan-switching.test.js`.
- Run the full unit suite command used by CI: `npm run test:unit:ci`.

## Coverage
- Confirms game switching clears stale lineups and auto-save state.
- Confirms calendar and shared tournament games remain read-only.
- Confirms regular database games still allow saving.
