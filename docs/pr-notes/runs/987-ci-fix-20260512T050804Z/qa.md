# QA notes

## Acceptance criteria
- The edit-team admin invite smoke test intercepts the current `auth.js` and `team-access.js` imports.
- The accept-invite admin redemption smoke test intercepts the current `auth.js` import.
- Assertions remain unchanged: existing-user fallback shows `EXIST111`, and redemption shows the admin-specific success message.

## Validation
Run the targeted Playwright smoke spec: `npx playwright test tests/smoke/admin-invite-redemption.spec.js --config=playwright.smoke.config.js --reporter=line`.

## Local blocker
The local workspace is missing the Playwright Chromium binary, so the targeted smoke command cannot execute until browsers are installed. CI has the browser dependency.
