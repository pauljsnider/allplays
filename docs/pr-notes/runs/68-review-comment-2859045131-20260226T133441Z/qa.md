# QA Role Summary

## Regression Guardrails
- Verify call ordering (`updateUserProfile` before `addTeamAdminEmail`) remains enforced.
- Add negative test: if re-read profile lacks team membership, do not attempt team update.

## Validation Scope
- Unit tests in `tests/unit/admin-invite.test.js` for success and failure branches.
- Static inspection of consumers (`auth.js`, `accept-invite.html`) with cache-bust version bump.
