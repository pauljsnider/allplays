# QA Notes

- Validate with targeted Playwright smoke spec: `npx playwright test --config=playwright.smoke.config.js --reporter=line tests/smoke/team-schedule-calendar.spec.js` while serving the repo at port 4173.
- Expected evidence: both affected team schedule calendar tests pass and no longer leave `#team-header` or `#schedule-list` as blank skeletons.
- Unit tests are not the primary gate because the failure is in the static-hosting Playwright module interception harness.
