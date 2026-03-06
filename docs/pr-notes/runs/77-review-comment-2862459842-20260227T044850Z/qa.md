## Risk Matrix
- High: Regression in admin invite acceptance causing blocked onboarding (`permission-denied`, stale access code).
- Medium: Partial-write behavior if post-grant transaction fails.
- Low: Email normalization/regression for existing admin invite flow.

## Automated Tests To Add/Update
- No new automated tests added in this patch; existing unit tests for `redeemAdminInviteAcceptance` still validate callback contract and normalization at orchestration layer.
- Follow-up candidate: integration-style Firestore emulator test for `redeemAdminInviteAtomicPersistence` permission ordering.

## Manual Test Plan
1. Redeem valid first-time `admin_invite` code with a user not currently in `coachOf`.
2. Confirm redirect success message appears and route goes to `dashboard.html`.
3. Verify Firestore docs after redemption:
- `users/{uid}.coachOf` includes team.
- `teams/{teamId}.adminEmails` includes normalized email.
- `accessCodes/{codeId}.used == true` with `usedBy` and `usedAt`.
4. Retry same code and confirm failure (`already used`).

## Negative Tests
- Invalid/missing code id rejects.
- Team mismatch in code rejects.
- Missing user email rejects.
- Already-used code rejects without overwriting usage state.

## Release Gates
- Unit test suite for admin invite module passes.
- No unrelated file churn.
- Manual verification of impacted admin invite workflow completed in staging/preview as available.

## Post-Deploy Checks
- Monitor invite redemption errors in console/support reports for 24h.
- Spot-check one new admin invite acceptance end-to-end.
- Confirm no spike in access-code retry failures.
