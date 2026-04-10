Objective: resolve the two unresolved PR review comments on the login flow only.

Current state:
- `login.html` imports `./js/login-page.js?v=1` while the module now exports `createLoginAuthStateManager`.
- `createLoginAuthStateManager().captureAuthenticatedUser()` returns early on falsy auth events without clearing any buffered user.

Required change:
- Bump the login-page module cache-busting token in `login.html`.
- Clear `pendingRedirectUser` when auth becomes falsy during redirect processing.

Risk surface:
- Login page boot path and post-auth redirect behavior.
- Blast radius is limited to `login.html` and `js/login-page.js`.

Acceptance:
- New HTML references the updated module URL.
- A null auth event cannot replay a stale buffered user after processing completes.
