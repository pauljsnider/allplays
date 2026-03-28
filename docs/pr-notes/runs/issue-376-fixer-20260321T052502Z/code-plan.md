Plan:
1. Add a unit-tested helper module for completed-game stat editor field resolution, payload building, and player navigation.
2. Add a `js/db.js` helper that writes absolute per-player completed-game stats into `aggregatedStats`.
3. Add a targeted `game.html` editor panel and wire it to the new helper and DB function.
4. Run focused unit tests, then the relevant broader stat-report tests.

Tradeoffs:
- This does not backfill play-by-play events for post-game corrections.
- It fixes report correctness first, which is the smallest change that delivers the user value in issue #376.
