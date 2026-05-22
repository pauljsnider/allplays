# Code Plan

- Add a small helper in `js/live-tracker-resume.js` to detect reversal stat broadcasts.
- Call the helper before building log entries in `buildResumeLogFromLiveEvents`.
- Add a Vitest case in `tests/unit/live-tracker-resume.test.js` for undo/remove exclusion.
