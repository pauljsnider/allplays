Implementation plan:
1. Add small helper accessors in `js/post-game-insights.js` for event stat key and value.
2. Update `extractEventPoints` to prefer top-level persisted fields, with `undoData` fallback.
3. Update `isOpponentEvent` to prefer top-level persisted `isOpponent`, with `undoData` fallback.
4. Run a focused runtime check covering both event shapes.
5. Commit the scoped fix.
