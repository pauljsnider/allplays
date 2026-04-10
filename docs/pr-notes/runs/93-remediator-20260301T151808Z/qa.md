# QA Role Notes

## Test Plan
- Update unit guard in `tests/unit/player-soft-delete-policy.test.js` to enforce replay-only includeInactive usage in `js/live-game.js`.
- Run targeted vitest file:
  - `tests/unit/player-soft-delete-policy.test.js`

## Expected
- Test passes and confirms replay-only includeInactive query shape.
