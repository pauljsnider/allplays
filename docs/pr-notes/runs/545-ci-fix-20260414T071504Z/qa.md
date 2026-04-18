# Acceptance Criteria
- `tests/smoke/help-center.spec.js` passes locally once Playwright Chromium is available.
- The spec still checks that workflow and page-reference files return HTML and do not rewrite to the homepage, except for `index.html` itself.
- Existing help center discovery assertions remain unchanged.

# QA Plan
- Run `npx playwright test --config=playwright.smoke.config.js tests/smoke/help-center.spec.js --reporter=line` against a local `python3 -m http.server 4173` server.
- Confirm both help-center smoke tests pass.
- Optionally run `npm test -- tests/unit/help-page-reference-integrity.test.js` equivalent via Vitest if needed for extra confidence.

# Risks And Rollback
- Main risk is accidentally weakening the non-rewrite guard for non-homepage files.
- Roll back by reverting the smoke test and re-evaluating the file list logic if broader coverage is needed.
