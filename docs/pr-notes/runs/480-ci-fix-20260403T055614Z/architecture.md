Objective: restore the login page forgot-password smoke flow in preview without changing product behavior.

Current state:
- `login.html` statically imports `createLoginAuthStateManager` from `js/login-page.js`.
- Preview smoke stubs `js/login-page.js` with only the older exports used by the forgot-password tests.
- Missing named ESM exports fail module evaluation before event listeners are registered.

Proposed state:
- Import `js/login-page.js` as a module namespace.
- Resolve `createForgotPasswordHandler` and `createLoginRedirectCoordinator` from that namespace.
- Use a local no-op fallback for `createLoginAuthStateManager` when the export is absent.

Blast radius:
- Scoped to login-page module wiring on `login.html`.
- No auth API, Firebase, or redirect logic changes.
- Production behavior is unchanged when the real export exists.
