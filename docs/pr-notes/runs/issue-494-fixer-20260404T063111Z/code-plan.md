# Code Role (fallback synthesis)

## Plan
1. Tighten `tests/unit/homepage-index.test.js` around replay rendering and fallback behavior.
2. Update `loadPastGames` in `js/homepage.js` to normalize query output before rendering.
3. Bump the homepage module cache key in `index.html`.
4. Run focused homepage unit tests, then stage and commit with issue reference.

## Non-Goals
- No changes to Firestore query logic in `js/db.js`.
- No refactor of live-game card rendering outside the replay coverage gap.
