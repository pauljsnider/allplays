Decision: normalize event field reads at the helper boundary instead of changing event producers or downstream insight logic.

Why:
- Preserves existing behavior for live/in-memory events.
- Aligns completed-game insight reads with the persisted Firestore schema used by `track.html` and `js/live-tracker.js`.
- Keeps blast radius contained to `js/post-game-insights.js`.

Controls:
- No data model migration.
- No changes to event writes.
- Fallback remains in place for `undoData` callers.
