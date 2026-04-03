Coverage target:
- `js/utils.js::parseICS`
- `edit-schedule.html` imported calendar row rendering

Test plan:
- Add a unit test that parses one `STATUS:CANCELLED` VEVENT and one `[CANCELED]` practice VEVENT, then asserts `status`, `summary`, `isPractice`, and `dtstart` survive parsing.
- Add a Playwright spec that stubs Edit Schedule dependencies, injects one cancelled game and one cancelled practice through calendar import, and verifies:
  - both rows remain visible
  - both rows show the `Cancelled` badge
  - date/title text uses `line-through`
  - neither row renders `Track` or `Plan Practice`

Validation commands:
- `npm test -- tests/unit/utils-ics-practice-classification.test.js tests/unit/edit-schedule-calendar-import.test.js`
- `./node_modules/.bin/playwright test tests/smoke/edit-schedule-calendar-cancelled-import.spec.js --config=playwright.smoke.config.js --reporter=line`

Residual risk:
- Browser assertions depend on the local static server and Playwright runtime being available in this environment.
