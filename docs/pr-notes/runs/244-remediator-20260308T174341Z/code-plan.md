# Code role

1. Patch `buildAthleteProfileSeasonSummary()` in `js/db.js` to fetch the linked team with `{ includeInactive: true }`.
2. Extend `tests/unit/athlete-profile-wiring.test.js` with a guard that the helper uses the explicit inactive-team opt-in.
3. Run the focused athlete-profile unit test file.
4. Stage only the scoped source, test, and run-note changes, then commit on the current branch.
