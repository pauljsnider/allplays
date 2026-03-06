# QA Role Synthesis

## Test strategy
- Add a focused unit regression in `tests/unit/signup-flow.test.js`:
  - Arrange `validateAccessCode` as `admin_invite`.
  - Ensure `redeemAdminInviteAcceptance` is called with expected arguments.
  - Ensure generic `markAccessCodeAsUsed` fallback is not called for admin invite.
  - Ensure verification email still sends on success.

## Regression guardrails
- Run:
  - `tests/unit/signup-flow.test.js` (new case + existing parent invite behavior)
  - `tests/unit/admin-invite-redemption.test.js` (helper contract unchanged)

## Manual verification notes
- Not required for targeted unit-level fix, but recommended in PR notes: simulate copied admin signup link from Edit Team and verify `coachOf` + team admin access after signup.
