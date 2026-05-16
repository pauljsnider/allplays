# QA notes

Manual validation focus:
1. Redeem household invite with matching signed-in email succeeds and grants parent dashboard access.
2. Redeem with mismatched signed-in email fails with a clear message and leaves code unused after rollback.
3. Simulate user/profile, player, and membership write failures independently; verify previous writes are removed/restored and code can be retried safely.
4. Verify household invite errors render as friendly messages for invalid/used code, missing team/player, permission denied, and network/unavailable conditions.

Repo has no automated test runner; use static syntax checks and targeted manual flow review.
