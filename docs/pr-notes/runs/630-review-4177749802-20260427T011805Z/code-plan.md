# Code Plan

## Implementation
- Add pure volleyball undo helpers in `js/live-scorekeeping-volleyball.js`:
  - `createVolleyballUndoState()`
  - `restoreVolleyballUndoState()`
- Import those helpers in `track-live.html` with cache-bust version update.
- Save `before` and `after` state into volleyball log undo metadata.
- Add volleyball handling in `undoLogEntry()`:
  - require newest entry
  - restore prior scores and serving team
  - update display
  - schedule score sync and live data flag
  - broadcast live undo event with restored score and serving team
- Track last synced serving team so volleyball serving-only state changes are not skipped.

## Validation Commands
- `npm test -- tests/unit/live-scorekeeping-volleyball.test.js`
- `npm test -- tests/unit/track-live-live-events.test.js`
- `git diff --check`
