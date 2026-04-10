Thinking level: medium
Reason: targeted UI-data-loss fix with existing test patterns and low architectural ambiguity.

Implementation plan:
1. Add a new unit test file for player private-profile edit payload behavior.
2. Add a focused unit test for `updatePlayerProfile()` private-doc write gating.
3. Introduce a small payload helper plus private-field dirty tracking in `player.html`.
4. Reuse existing `updatePlayerProfile()` behavior by omitting untouched private keys rather than changing Firestore write logic.
5. Run targeted Vitest commands, then stage and commit all changed files with an issue-referencing message.
