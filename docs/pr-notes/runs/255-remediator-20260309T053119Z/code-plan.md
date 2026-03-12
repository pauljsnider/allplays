Implementation plan:
1. Remove delegated-coach logic from `js/team-access.js::hasFullTeamAccess`.
2. Update `tests/unit/team-access.test.js` to encode the corrected authorization contract.
3. Run the focused unit test file.

Non-goals:
- No Firestore rules changes.
- No changes to `coachOf` persistence or invite flows.
- No unrelated access-control refactors.
