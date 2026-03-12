Implementation plan:
1. Update the `deriveResumeClockState()` call in `js/live-tracker.js` to pass `period`, `gameClockMs`, and `clock` from `currentGame` in addition to the existing `liveClock*` fields.
2. Extend `tests/unit/live-tracker-resume.test.js` with a source-based regression that asserts the real caller includes both modern and legacy fields.
3. Run the targeted test file and commit the minimal diff.
