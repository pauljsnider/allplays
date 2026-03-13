Implementation plan:
1. Update `js/shared-games.js` to use a delimiter-safe synthetic ID prefix while accepting legacy IDs on decode.
2. Update `js/db.js` so `getGame()` and `subscribeGame()` project shared games through the same team-facing mapper used by `getGames()`.
3. Replace `split('::')` with first-delimiter parsing in the affected `calendar.html` and `parent-dashboard.html` hydration paths.
4. Extend `tests/unit/shared-games.test.js` for the new ID format and legacy decode coverage.
