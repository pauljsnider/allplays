Thinking level: medium
Reason: one-page state bug with a narrow persistence blast radius and an existing inline-page unit-test pattern.

Implementation plan:
1. Extract `loadGame(game)` and save-click handler behavior into a new Vitest regression file that uses page-source evaluation plus DOM stubs.
2. Write assertions that reproduce the stale `lineups` carryover and the incorrect save payload for Game B.
3. Patch `game-plan.html` with a fresh game-plan factory/reset path, keeping the data shape unchanged.
4. Run the new regression file and the existing `tests/unit/game-plan-interop.test.js`.
5. Commit the docs, test, and page fix together with an issue-referencing message.

Tradeoffs:
- This is not a full browser E2E test, but it exercises the real inline page code path under automation with much lower setup cost.
- A helper-based reset is slightly more code than ad hoc field clearing, but it is easier to reason about and less likely to miss future fields.
