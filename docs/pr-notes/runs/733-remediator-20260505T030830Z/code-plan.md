# Code Plan

## Implementation Plan
1. Add a small cancellation predicate in `js/officiating-utils.js`.
2. Return no warnings when the candidate game is cancelled.
3. Skip cancelled existing games inside the conflict scan loop.
4. Extend `tests/unit/officiating-utils.test.js` to cover cancelled existing games and cancelled candidate games.

## Files
- `js/officiating-utils.js`
- `tests/unit/officiating-utils.test.js`
