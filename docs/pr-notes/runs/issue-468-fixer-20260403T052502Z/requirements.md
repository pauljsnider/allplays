Objective: restore automatic redirect on `login.html` for already-authenticated users after the Google redirect probe completes with no result.

Current state:
- `checkAuth` can fire while `isProcessingAuth` is still `true`.
- That callback is ignored and never replayed.
- Authenticated users remain on `login.html`, including invite links that should land on `accept-invite.html`.

Proposed state:
- Preserve the existing guard against redirecting during an active Google redirect check.
- Capture any authenticated user seen during that guard window.
- Replay the normal post-auth redirect once the Google redirect probe finishes without handling a redirect itself.

Constraints:
- Keep signup-vs-login invite behavior unchanged.
- Do not redirect when there is no authenticated user.
- Keep the patch local to the login flow and easy to review.
