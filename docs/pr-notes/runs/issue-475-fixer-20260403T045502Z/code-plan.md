Implementation plan:
1. Add a string-based unit test for `player.html` authorization wiring.
2. Store the loaded team object in page state.
3. Import `hasFullTeamAccess` from `js/team-access.js`.
4. Replace `coachOf`-based edit gating with `hasFullTeamAccess(currentUser, currentTeam) || isParent`.
5. Run focused and full unit tests, then commit the targeted patch.
