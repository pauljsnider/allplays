Thinking level: medium.
Reason: narrow code change, but it touches access control and rollback behavior.

Implementation plan:
1. Patch `redeemAdminInviteAtomicPersistence(...)` to reject expired admin invite codes before any user grant and again inside the transaction.
2. Add a regression test that asserts the expiration guard exists in the atomic persistence function.
3. Run targeted Vitest coverage for admin invite redemption files.
4. Stage and commit only the scoped changes plus the required run notes.
