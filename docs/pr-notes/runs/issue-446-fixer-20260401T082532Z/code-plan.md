Thinking level: medium
Reason: browser-level schedule behavior spans merged data, filter state, calendar rendering, and a modal path.

Implementation plan:
1. Add a Team page smoke spec with explicit module stubs for DB, utils, auth, Firebase, standings, and banner dependencies.
2. Run the new smoke spec before the fix to confirm the current failure.
3. Update `team.html` to force practice visibility when the `Upcoming Practices` filter is active.
4. Re-run the smoke spec and the relevant unit test lane.
5. Commit the targeted fix and coverage together.
