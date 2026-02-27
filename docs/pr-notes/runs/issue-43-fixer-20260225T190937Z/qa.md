# QA role output

## Test strategy
- Add unit tests for redirect helper:
  - invite code + redemption path => `accept-invite.html?code=...`
  - no code => default redirect
  - malformed code => default redirect
  - redemption flag off => default redirect
- Run targeted test file first to show failure before fix.
- Run full unit suite after fix.

## Regression guardrails
- Verify signup flow still uses activation code behavior.
- Verify standard login without invite still routes by role.

## Residual risk
- Google redirect mode differences may require future focused e2e if invite link is used with social login.
