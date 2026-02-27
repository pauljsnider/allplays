# Architecture role output

## Root cause
`login.html` consumes `code` only to toggle signup UI. Post-auth redirects always call `getRedirectUrl(user)` and never invoke invite redemption.

## Minimal design
- Introduce a tiny pure helper module for redirect resolution.
- Helper chooses `accept-invite.html?code=...` only when:
  - caller indicates invite redemption is required, and
  - code is valid 8-char token.
- Update `login.html` post-auth redirects to call helper in login paths.

## Blast radius
- Low; only login-page redirect decisions and one new pure helper module.
- No Firestore schema/rules changes.

## Control equivalence
- Invite processing still centralized in `accept-invite.html`.
- No elevated data access added.
- Audit trail remains via existing access code usage updates during redemption.

## Rollback
- Revert helper import and redirect calls in `login.html`.
