## Architecture role summary

- Evidence: `js/post-game-insights.js` at PR head commit `10af26d` already normalizes `event.statKey`, prefers `event.value`, and prefers top-level `event.isOpponent` before falling back to `undoData`.
- Decision: no production code patch required; strengthen branch confidence with regression tests that mirror persisted completed-game event documents.
- Blast radius: none beyond unit-test expectations. No data model or runtime control changes.
- Rollback: revert the added test fixture updates if they prove inaccurate.
