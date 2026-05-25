# Code Plan

1. Add a pure `buildResumeLineupElapsedMs` helper in `js/live-tracker-resume.js`.
2. Import and use the helper in `js/live-tracker.js` where elapsed time is applied to active lineup stats.
3. Use `liveState.restoredLocalTrackerStateAt` to avoid applying elapsed time already represented in the local snapshot.
4. Add focused unit tests in `tests/unit/live-tracker-resume.test.js`.
