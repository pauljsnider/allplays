Current state:
- `login.html` owns UI mode switching and auth event handlers.
- `js/login-page.js` owns redirect coordination using URL params plus `postGoogleAuthMode`.
- `js/invite-redirect.js` normalizes invite codes and builds `accept-invite.html` targets.

Proposed state:
- Keep the architecture unchanged.
- Add integration coverage at the page boundary so regressions in module wiring fail fast.

Blast radius:
- No data model or Firebase rule changes.
- Expected code changes should stay inside login-page redirect handling and test coverage.

Controls:
- Preserve invite redemption only for `type=parent|admin`.
- Preserve existing dashboard redirects for non-invite logins and Google signup mode.
