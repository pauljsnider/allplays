# QA Role Summary

## Targeted Regression Matrix
1. Email-link invite acceptance with profile email absent -> should succeed (fixed path).
2. Logged-in user with invite code -> should continue succeeding.
3. Manual code entry while logged in -> should continue succeeding.
4. Parent invite acceptance -> unchanged behavior.

## Validation Commands
- `node --check js/admin-invite.js`
- `git diff -- accept-invite.html`

## Known Constraint
Local environment has no `npm`/`npx` toolchain, so Vitest execution is not available here.
