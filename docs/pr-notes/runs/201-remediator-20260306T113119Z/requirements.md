Objective: Resolve PR #201 review feedback on admin invite redemption result validation.

Current state:
- `processInviteCode()` assumes `redeemAdminInviteAtomically()` returns a truthy success payload.
- An empty or malformed object would still reach the success return path.

Required change:
- Fail closed unless the atomic redemption result exists and `success === true`.
- Keep scope limited to the admin invite acceptance path and its regression coverage.
