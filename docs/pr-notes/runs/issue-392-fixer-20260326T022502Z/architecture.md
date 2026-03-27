# Architecture role output

## Current state
- Redirect decisions are split between inline `login.html` logic and shared helpers in `js/auth.js` and `js/invite-redirect.js`.
- `checkAuth` auto-redirect uses the raw invite URL state and cannot distinguish a Google redirect-return that originated from signup mode.

## Proposed state
- Move the login-page redirect coordination into a small dedicated module.
- Keep `login.html` responsible for wiring DOM events, while the new module owns redirect-return and auth-state routing decisions.

## Control equivalence
- No backend, auth provider, or Firestore behavior changes.
- Redirect targets still flow through the existing `getRedirectUrl` and `getPostAuthRedirectUrl` helpers.
- Blast radius remains within the login page.

## Rollback
- Revert the new login-page module and restore the inline redirect logic in `login.html`.
