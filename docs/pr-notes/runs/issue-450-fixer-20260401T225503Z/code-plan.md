Plan:
1. Add a fail-first unit test in `tests/unit/live-tracker-finish.test.js` for resumed incomplete logs through a new save-preparation seam.
2. Extract the conditional mismatch/log-entry logic from `saveAndComplete()` into `js/live-tracker-finish.js`.
3. Update `js/live-tracker.js` to use the helper and keep DOM/render side effects local.
4. Run targeted Vitest coverage for finish and integrity behavior.
5. Commit all changes with an issue-referencing message.

Non-goals:
- No refactor of unrelated tracker behavior.
- No change to reconciliation rules themselves.
