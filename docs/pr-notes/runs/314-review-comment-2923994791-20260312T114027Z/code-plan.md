## Code role

- Implement `buildPersistedResumeClockState(game)` in `js/live-tracker-resume.js`.
- Use that helper at the `deriveResumeClockState(...)` call site in `js/live-tracker.js`.
- Replace the source-text assertion in `tests/unit/live-tracker-resume.test.js` with a runtime test that feeds a legacy-only game doc through the helper and into `deriveResumeClockState`.
