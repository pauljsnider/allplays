Decision: add a tiny login-page auth state helper instead of spreading more stateful branching through inline `login.html` code.

Why:
- The bug is a timing problem between two async sources: `checkAuth` and `handleGoogleRedirectResult()`.
- A helper can hold the pending authenticated user and expose a single place to decide when a redirect is allowed.
- Blast radius stays within `login.html` and `js/login-page.js`.

Design:
- Track `isProcessingAuth` and `pendingUser`.
- When `checkAuth` receives a user during processing, store it instead of redirecting.
- When processing finishes, return the pending user exactly once so `login.html` can apply the existing redirect coordinator.

Risk surface:
- Authenticated users reaching `login.html`.
- Invite redemption routing for `?code=...&type=parent|admin`.

Rollback:
- Revert the helper wiring in `login.html` and the added helper exports/tests.
