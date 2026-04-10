Thinking level: medium
Reason: existing behavior is mostly correct; the work is finding the smallest extraction that creates reliable CI coverage without widening scope.

Plan:
1. Add failing Vitest coverage for wrap-up transition/prefill/persist/redirect behavior.
2. Implement a minimal `js/game-day-wrapup.js` helper for deterministic wrap-up logic.
3. Rewire `game-day.html` to call the helper for completed transition, wrap-up render values, and finish payload/redirect.
4. Run the focused Vitest suite.
5. Stage changed files and commit with an issue-referencing message.
