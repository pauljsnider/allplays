Implementation plan:
1. Add `js/stat-leaderboards.js` for config normalization, formula evaluation, grouped stat discovery, and player leaderboard generation.
2. Add unit tests that fail on missing derived-stat and leaderboard behavior.
3. Normalize config writes in `js/db.js`.
4. Extend `edit-config.html` with an optional advanced stat-definition textarea and richer config list display.
5. Use the shared helper in `team.html` and `player.html` to render grouped top-stat analytics from season totals.

Out of scope for this patch:
- Persisting recomputed derived aggregates back into Firestore.
- Team-scope leaderboard widgets.
- Drag-and-drop config reordering.
