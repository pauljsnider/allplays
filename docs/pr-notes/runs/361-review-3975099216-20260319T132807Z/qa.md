Scope:
- `tests/smoke/footer-support-links.spec.js`

Primary regression covered:
- Footer Help Center smoke now detects a broken destination page, not just a changed URL.

Checks executed:
- `./node_modules/.bin/vitest run tests/unit`
- `./node_modules/.bin/playwright test tests/smoke/footer-support-links.spec.js --config=playwright.smoke.config.js --reporter=line`

Observed results:
- Unit suite passed: 102 files, 486 tests.
- Focused Playwright run did not execute browsers in this environment because required system libraries are missing.
- The failure occurs at browser launch, before spec execution, so it does not contradict the patch logic.

Manual review points:
- Homepage test now asserts `response.ok()` for the Help Center document navigation.
- Homepage test still asserts the `/help.html` pathname.
- Homepage test now asserts the `ALL PLAYS Help Center` heading is visible.
- Login-page shared footer wiring assertions remain unchanged.
