# Code Role Notes

## Patch Plan
- File: `js/live-tracker.js`
- Change: move `isFinishing = true` from pre-commit section to post-`batch.commit()`/`endLiveBroadcast()` success path.

## Rationale
- Keeps `hasUnsavedActivity()` true during in-flight writes.
- Preserves existing catch-path behavior (`isFinishing = false`, button re-enable, lock release).

## Conflict Resolution
- Requirements and QA prefer explicit in-flight protection.
- Architecture prefers least-change patch.
- Final synthesis: single assignment reorder satisfies both with minimum blast radius.
