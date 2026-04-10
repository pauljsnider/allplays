Planned change:
1. Update `resolveTieGroup()` in `js/native-standings.js` so each split partition restarts with the tiebreaker stack appropriate for its new size.
2. Add one regression test in `tests/unit/native-standings.test.js` covering the split-from-multi-team-to-two-team case.
3. Run the targeted Vitest file and commit only the remediation files.
