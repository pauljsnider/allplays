# QA Notes

## QA Plan
- Re-run the affected smoke spec: `npx playwright test -c playwright.smoke.config.js tests/smoke/team-schedule-calendar.spec.js --reporter=line`.
- Verify both calendar/filter tests pass and `#team-header` / `#schedule-list` no longer remain blank.

## Risk Coverage
- Covers test-drift from cache-busted/imported modules in `team.html`.
- Does not broaden assertions or mask product logic; stubs only satisfy unrelated imports so existing assertions remain meaningful.
