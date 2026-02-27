# Code role output

## Plan
1. Add `js/parent-invite-signup.js` helper to centralize atomic parent invite completion.
2. Add `tests/unit/parent-invite-signup.test.js` regression tests that encode fail-closed behavior.
3. Update `js/auth.js` parent invite paths (email/password + Google new-user) to use helper and remove error swallowing.
4. Run targeted tests and full unit suite.
5. Commit all changes with issue reference.

## Conflict resolution synthesis
- Requirements and QA both prioritize atomic failure and clear error surfacing.
- Architecture recommends single shared helper to avoid logic drift across auth providers.
- Chosen implementation follows shared helper path for consistent behavior and smallest safe patch.
