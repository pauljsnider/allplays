# QA role output

## Test strategy
- Add unit coverage for the Google redirect-return path from an invite link in login mode.
- Add unit coverage for the same return path in signup mode and force the auth-state callback after the Google redirect handler to prove the race is closed.
- Preserve an assertion that already-authenticated invite-link visits still redeem the invite by default.

## Validation
- Run the new targeted unit test file first to capture the failing behavior.
- Run the auth-related unit suite touching invite and login redirect behavior after the fix.

## Residual risk
- Real Google provider behavior is still mocked, so browser-specific popup/redirect transport differences remain covered indirectly rather than end-to-end.
