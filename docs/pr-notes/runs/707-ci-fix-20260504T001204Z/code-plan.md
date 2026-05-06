# Code plan

1. Add a `TEAM_PASS_STUB` in `tests/smoke/team-schedule-calendar.spec.js` exporting `renderTeamPassCard()`.
2. Route `**/js/team-pass.js?v=1` to that stub in `mockTeamPageModules()`.
3. Re-run the two failing smoke tests.
