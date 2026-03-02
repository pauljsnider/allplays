# QA role output (manual fallback)

Test strategy:
- Unit-test helper behavior for expiration handling inputs:
  - `Timestamp`-like (`toMillis`) value in past => expired.
  - Future timestamp => not expired.
  - Missing/invalid expiration => not expired (preserve existing optional behavior).

Regression guardrails:
- Run new targeted unit test file.
- Run existing invite helper tests to ensure no unrelated invite path regressions.

Manual sanity checks (recommended for PR):
1. Redeem an expired parent invite in `parent-dashboard.html` and confirm expiration error.
2. Redeem a valid invite and confirm parent linkage succeeds.
3. Confirm used-code behavior remains unchanged.
