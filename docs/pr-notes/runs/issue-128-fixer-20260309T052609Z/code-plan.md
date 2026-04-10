Implementation plan:
1. Update delegated-coach expectations in `tests/unit/team-access.test.js`.
2. Run the focused test to confirm the new regression fails on current code.
3. Patch `js/team-access.js` so `coachOf` membership grants full access only for the matching team id.
4. Re-run focused tests for helper behavior and wiring.
5. Stage the helper, tests, and run notes, then commit with an issue-referencing message.

Non-goals:
- No unrelated refactors to page scripts.
- No UI copy or navigation changes.
