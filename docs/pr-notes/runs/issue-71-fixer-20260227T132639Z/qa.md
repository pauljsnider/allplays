# QA Role (allplays-qa-expert equivalent)

## Test Strategy
- Add unit tests around extracted invite processing helper.
- Mock dependencies (`validateAccessCode`, `getTeam`, `getUserProfile`, `updateUserProfile`, `markAccessCodeAsUsed`, `redeemParentInvite`).

## Primary Regression Assertion
- For `admin_invite`, successful redemption must call `markAccessCodeAsUsed` with validated `codeId` and `userId`.

## Additional Guardrails
- Keep existing parent invite behavior intact.
- Ensure unknown invite types still throw.
- Ensure invalid validation short-circuits and throws existing validation message.

## Manual Smoke Checks (post-merge)
- Redeem admin invite once as User A: success.
- Redeem same code as User B: receive `Code already used`.
