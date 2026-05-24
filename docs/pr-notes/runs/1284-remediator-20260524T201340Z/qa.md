# QA

- Run targeted unit coverage: `npx vitest run tests/unit/game-plan-switching.test.js --reporter=verbose`.
- Passing criteria: the switching suite executes all assertions and does not fail before assertions with a missing helper reference.
- Regression surface: game switching state reset, autosave cancellation, save-state handling for calendar/shared games, and lineup normalization dependency wiring.
