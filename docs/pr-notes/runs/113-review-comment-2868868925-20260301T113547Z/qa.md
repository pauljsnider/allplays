# QA Role Summary

## Test Strategy
Focus on Google OAuth new-user parent-invite failure regression behavior.

## Targeted Coverage
- Popup flow: invite redeem failure rejects and runs cleanup.
- Popup flow with delete failure: sign-out still executes and original invite error is rethrown.
- Redirect flow: invite redeem failure rejects and runs same cleanup.
- Session state: pending activation code is cleared in failure paths.

## Commands
- `node ./node_modules/vitest/vitest.mjs run tests/unit/auth-google-parent-invite-cleanup.test.js`

## Acceptance Criteria
- All tests pass.
- No regression in existing pass cases within target suite.
