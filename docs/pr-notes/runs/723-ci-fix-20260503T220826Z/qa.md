# QA Notes

## QA Plan
- Run the affected preview smoke spec locally:
  `npx playwright test --config=playwright.smoke.config.js tests/smoke/team-schedule-calendar.spec.js --reporter=line`
- Verify both failing tests pass:
  - practice calendar filter and modal
  - duplicate/cancelled event filter buckets

## Validation Result
- Local affected smoke spec passed: 2 passed.

## Risk Focus
- Confirms the test harness no longer fails at ES module import time.
- Keeps assertions focused on existing schedule filtering behavior rather than weakening expectations.
