## Coverage Target
- Real Firebase boot path for `login.html`
- Real Firebase boot path for `reset-password.html`

## Test Strategy
1. Load `login.html` without mocking `js/auth.js` or `js/firebase.js`.
2. Fail on:
   - uncaught page errors
   - failed script/module requests
   - fatal console errors
   - broken JS/config responses
3. Assert login UI is actionable:
   - login form visible
   - Google sign-in button visible
4. Load `reset-password.html` with `mode=resetPassword` and a fake `oobCode`.
5. Route the Firebase Auth backend verification call to an invalid-action-code response.
6. Assert the page renders its invalid-link/error state instead of crashing.

## Validation Notes
- Preferred command: `pnpm exec playwright test tests/smoke/firebase-auth-bootstrap.spec.js --config=playwright.smoke.config.js`
- Environment blocker observed during investigation: Playwright browser dependencies are missing on this host, so full browser execution may require system package install before CI-local reproduction.
