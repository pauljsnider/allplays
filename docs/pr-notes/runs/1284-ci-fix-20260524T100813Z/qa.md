# QA Notes

## QA Plan
- Run the focused failing unit file: `npx vitest run tests/unit/game-plan-switching.test.js --reporter=verbose`.
- Confirm all six game switching tests pass, including lineup clearing, auto-save cancellation, calendar read-only handling, regular DB save enablement, and shared game notice.

## Result
Focused unit test passed: 6/6 tests green.
