Objective: resolve PR thread `PRRT_kwDOQe-T585zqfTx` by ensuring existing-team admin access is only persisted after invite creation succeeds.

Current state:
- `inviteExistingTeamAdmin()` always calls `addTeamAdminEmail()` after `inviteAdmin()`, even when the response is malformed or missing a valid invite code.

Required state:
- Persist admin access only when `inviteAdmin()` proves a valid outcome: either `existingUser === true` or a non-empty invite `code` exists.
- Keep scope limited to the existing-team admin invite helper and its regression coverage.

Assumptions:
- A missing or malformed invite response means invite creation failed and must fail closed.
- Existing users should still get immediate access persistence without waiting for email delivery.
