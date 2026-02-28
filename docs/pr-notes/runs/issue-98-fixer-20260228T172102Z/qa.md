# QA Role (allplays-qa-expert)

## Objective
Prove parent invite signup no longer resolves as success when invite linkage fails.

## Risk-Based Test Focus
- Negative path: parent invite code where `redeemParentInvite()` throws should make `signup()` reject.
- Positive control: standard access-code signup should still resolve.
- Regression guardrail: verify parent-invite failure does not mark normal success in logic under test.

## Validation Commands
- `pnpm dlx vitest run tests/unit/auth-signup-parent-invite.test.js`

## Acceptance Criteria
- New regression test fails before fix and passes after fix.
- No failures in touched test file after final patch.
