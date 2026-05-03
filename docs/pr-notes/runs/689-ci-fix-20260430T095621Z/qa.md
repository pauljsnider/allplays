# QA Notes

## Validation Plan
- Run the affected Playwright smoke specs for the two failing team schedule calendar cases.
- Run the full team schedule calendar smoke file if time allows.

## Commands
- `npx playwright test tests/smoke/team-schedule-calendar.spec.js --config=playwright.smoke.config.js --grep "team schedule calendar shows only practices|team schedule keeps" --reporter=line`
- `npx playwright test tests/smoke/team-schedule-calendar.spec.js --config=playwright.smoke.config.js --reporter=line`
