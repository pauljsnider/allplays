Plan:
1. Extend `js/game-day-wrapup.js` with sport resolution plus prompt builder helpers.
2. Update `tests/unit/game-day-wrapup.test.js` with failing prompt coverage.
3. Replace inline wrap-up prompt strings in `game-day.html` with helper calls.
4. Run `npm test -- tests/unit/game-day-wrapup.test.js` or the closest supported Vitest invocation, then run the full unit suite if practical.
5. Commit the fix with issue reference once tests pass.

Non-goals:
- No changes to broader AI chat context.
- No changes to tracker routing, stat config loading, or Firestore data shape.
