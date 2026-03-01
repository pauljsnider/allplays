# Code role synthesis

## Implementation plan
1. Extend `tests/unit/team-access.test.js` with regression assertions that represent edit-page authorization expectations for delegated coaches.
2. Update `edit-roster.html` to import `hasFullTeamAccess` and replace inline `hasAccess` function body with helper call.
3. Update `edit-team.html` to import `hasFullTeamAccess` and replace inline conditional permission check with helper call.
4. Run targeted unit tests (`team-access.test.js`) then run full unit test suite.
5. Commit fix + tests with issue reference.

## Non-goals
- No UI redesign.
- No broader auth refactor beyond replacing duplicated checks.
