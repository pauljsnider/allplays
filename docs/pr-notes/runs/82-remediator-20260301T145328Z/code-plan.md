# Code role plan
1. Update `redeemAdminInviteAtomically` to persist admin email with robust fallback to authenticated user's email when user profile email is missing.
2. Update `tests/unit/accept-invite-flow.test.js` to assert atomic redemption dependency behavior instead of removed legacy calls.
3. Run targeted test command for the updated unit test file.
4. Commit only scoped files.
