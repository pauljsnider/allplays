# QA Notes

Failing check: `preview-smoke [preview-smoke]`.

Validation target: `npx playwright test tests/smoke/team-schedule-calendar.spec.js --config=playwright.smoke.config.js --reporter=line`.

Expected result: both team schedule calendar smoke tests pass, confirming the page bootstraps and the practice, duplicate, cancelled, upcoming, and past-event filter assertions execute against rendered schedule rows instead of a blank placeholder.
