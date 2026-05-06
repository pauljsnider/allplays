# QA Notes

## QA Plan
- Re-run the two failing Playwright smoke tests in `tests/smoke/team-schedule-calendar.spec.js`.
- Run the full `team-schedule-calendar.spec.js` smoke file to catch adjacent schedule regressions.

## Evidence Target
- `npx playwright test -c playwright.smoke.config.js tests/smoke/team-schedule-calendar.spec.js --grep "team schedule calendar shows only practices|team schedule keeps tracked" --reporter=line`
- `npx playwright test -c playwright.smoke.config.js tests/smoke/team-schedule-calendar.spec.js --reporter=line`
