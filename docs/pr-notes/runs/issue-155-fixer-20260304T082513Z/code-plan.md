# Code Role Plan

## Files to change
- `js/live-game.js`
- `track-live.html`
- `live-game.html`
- `js/live-game-state.js` (new)
- `js/live-tracker-field-status.js` (new)
- `tests/unit/live-game-state.test.js` (new)
- `tests/unit/live-tracker-field-status.test.js` (new)

## Minimal patch strategy
1. Add helper modules and tests (initially failing against current behavior assumptions).
2. Wire `live-game.js` to helper functions:
   - opponent name resolver
   - normalized stat column list (no forced FLS)
   - reset event handling
   - generic lineup labels
3. Update `track-live.html`:
   - emit reset event and reset game doc/liveLineup on reset
   - implement on-field/bench column + timer bookkeeping with helper module
   - opponent name fallback
   - style refresh only
4. Update copy in `live-game.html` for generic language/icon.
5. Run targeted unit tests and finalize commit.
