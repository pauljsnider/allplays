# QA role notes

Targeted test additions in `tests/unit/native-standings.test.js`:
1. Verify status-less games are ignored and do not inflate GP/points.
2. Verify in-progress rematch does not affect `head_to_head` tie ordering.

Validation plan:
- Run `npx vitest run tests/unit/native-standings.test.js` from repo root.
- Confirm new tests fail before fix (conceptually) and pass after fix.
