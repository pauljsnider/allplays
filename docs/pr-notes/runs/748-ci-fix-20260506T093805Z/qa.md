# QA notes

Acceptance criteria:
- `team.html#teamId=team-a` boots under `mockTeamPageModules()`.
- The team header renders the mocked team name.
- Schedule calendar/list filters retain existing assertions for practices, tracked duplicates, cancelled events, and past/upcoming buckets.

Validation command:
- `npx playwright test tests/smoke/team-schedule-calendar.spec.js --grep "team schedule calendar shows only practices|team schedule keeps tracked duplicates"`
