# Code Plan

Subagents were unavailable in this environment, so this role analysis was completed inline.

## Implementation plan
1. In `tests/smoke/team-schedule-calendar.spec.js`, update the DB module route from `**/js/db.js?v=76` to `**/js/db.js?v=76` to match `team.html`.
2. Add `getLocalAttractionSponsors()` to the DB stub export list, returning an empty array.
3. Run the targeted Playwright smoke spec.
4. Commit the test harness fix only.
