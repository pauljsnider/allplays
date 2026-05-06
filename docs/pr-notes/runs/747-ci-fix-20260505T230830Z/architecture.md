# Architecture Notes

## Acceptance Criteria
- Team schedule smoke tests boot `team.html` through the same mocked data path used by the assertions.
- New `team.html` module imports are covered by smoke fixtures so the page does not depend on unrelated production modules during static-hosting smoke.

## Architecture Decisions
- Treat the failure as smoke-fixture drift: the DOM stayed at initial whitespace, which is consistent with client-side module initialization not completing before `init()` renders the team header and schedule.
- Keep the fix inside `tests/smoke/team-schedule-calendar.spec.js`; no production behavior should change for a CI fixture problem.

## Risks And Rollback
- Risk is limited to Playwright smoke fixtures. Rollback is reverting the test fixture additions.
