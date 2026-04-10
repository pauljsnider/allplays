Regression target:
- Existing signed-in user opens `login.html`.
- Existing signed-in user opens `login.html?code=ABCDEFGH&type=parent`.

Test approach:
- Add unit coverage for pending authenticated users observed while processing is locked.
- Assert no redirect occurs until processing ends.
- Assert the stored user is released once and then cleared.

Manual validation to run:
- `npm test -- tests/unit/login-page.test.js`
- `npm test -- tests/unit/login-page.test.js tests/unit/login-page-forgot-password.test.js`

Primary regression guard:
- Invite redemption after Google signup remains suppressed unless the flow was a login.
