# QA Note

## QA Plan
- Run the affected Playwright smoke spec for `tests/smoke/team-schedule-calendar.spec.js`.
- Confirm the two failing assertions now receive stubbed team/game data instead of an empty real-module render.
- Optionally run the full preview smoke suite in CI after commit.

## Failure Analysis
- The page loaded, but `#team-header` and `#schedule-list` contained only placeholder whitespace.
- `team.html` imports `js/db.js?v=76`, while the smoke test only intercepted `js/db.js?v=76`.
- Because the db stub was not applied, the page did not receive the deterministic Team A/Falcons fixture data required by the assertions.
