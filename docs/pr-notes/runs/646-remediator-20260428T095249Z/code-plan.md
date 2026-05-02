# Code Plan

1. Update `loadRosterRolloverTeams()` in `edit-team.html` to pass `currentUser.email || currentUser.profileEmail` to `getUserTeamsWithAccess`.
2. Add `rosterRolloverPreviewRequestId` state.
3. Increment the request id on source team changes and rollover disable, then ignore preview success/error handlers that do not match the latest request id or current select value.
4. Update the focused roster rollover wiring test to assert the profile fallback and stale-request guard.
5. Validate with the affected unit test.
