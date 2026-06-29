# Architecture Notes

## Acceptance Criteria
- Restore the admin invite signup cache-busting unit test without changing runtime invite behavior.
- Keep accept-invite module import contract aligned with current page implementation.

## Architecture Decisions
- Treat the failure as test drift: `accept-invite.html` already imports `redeemHouseholdInvite` from `./js/db.js?v=76`, and the broader accept-invite page tests assert that same contract.
- Update only the stale cache-busting expectation rather than reverting source code to an older db module version.

## Risks And Rollback
- Risk is limited to test coverage text expectations. No runtime code path changes.
- Rollback is a single test assertion revert if needed.
