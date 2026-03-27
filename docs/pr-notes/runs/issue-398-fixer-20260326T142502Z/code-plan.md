Implementation plan:
1. Add a new unit test file for viewer lineup sync helpers.
2. Run that test first and confirm failure against current exports/behavior.
3. Add viewer lineup normalization and rendering helpers to `js/live-game-state.js`.
4. Switch `js/live-game.js` lineup rendering to use the helper output.
5. Run the relevant Vitest files.
6. Commit the targeted change set referencing issue #398.

Constraints:
- No unrelated refactor.
- No tracker-side behavior changes.
- Keep cache-busting import updated in `live-game.js` for the touched helper module.
