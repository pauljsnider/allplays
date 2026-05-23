# QA notes

## Root cause
- The Playwright test used `page.locator('#team-name-display')`, but the smoke stub for `renderTeamAdminBanner` injected a second element with the same ID.
- Playwright strict mode correctly failed because the locator resolved to both the page header span and the stubbed banner span.

## QA plan
- Run the affected Playwright smoke spec only: `npx playwright test tests/smoke/edit-config-platform-admin.spec.js`.
- Confirm the platform admin workflow passes and no strict-mode duplicate-ID violation remains.
