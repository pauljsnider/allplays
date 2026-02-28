# Code Role Plan

## Smallest Safe Patch
1. Introduce comparator helpers in `js/live-tracker-resume.js` for progression ranking and candidate selection.
2. Evaluate both `latestByTimestamp` and `mostAdvanced` in mixed datasets.
3. Return the more advanced candidate to avoid stale restore.
4. Add one focused unit test for mixed timestamp state.

## Rollback
Single-commit rollback restores previous behavior.
