Chosen thinking level: medium.
Reason: the bug is flow-specific, but invite persistence already has two parallel implementations and the safest fix is to unify them without broad refactoring.

Plan:
1. Update `js/admin-invite.js` to delegate persistence to `redeemAdminInviteAtomicPersistence(...)`.
2. Keep the public helper signature stable for `js/auth.js`.
3. Add regression coverage for atomic delegation and normalized email handling.
4. Bump cache-bust versions for the changed auth import chain.
5. Run targeted Vitest files that cover signup and admin invite redemption.
