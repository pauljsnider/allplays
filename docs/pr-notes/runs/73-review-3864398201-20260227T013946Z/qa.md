# QA Role Notes

## Regression focus
- Parent invite signup rollback sequencing and conditional auth deletion.
- Google new-user redirect path cleanup of `pendingActivationCode`.

## Test strategy
- Unit: extend `tests/unit/parent-invite-signup.test.js` with rollback-failure branch assertion (`rollbackAuthUserFn` not called).
- Smoke: run targeted Vitest file for parent invite signup.

## Residual gap
- No isolated auth-module unit test harness for browser-session redirect flow in this patch; verified by code-path inspection and guarded `finally` placement.
