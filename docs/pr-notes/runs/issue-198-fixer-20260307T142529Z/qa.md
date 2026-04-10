Focus:
- Prevent false-success Google admin invite onboarding.

Regression risks:
- Swallowing admin redemption errors for popup or redirect Google auth.
- Regressing successful admin invite signups when only the follow-up profile write fails.

Coverage plan:
1. Add unit coverage for popup Google admin invite failure cleanup.
2. Add unit coverage for redirect Google admin invite failure cleanup.
3. Add unit coverage proving post-redeem profile write failures remain non-fatal.

Validation:
- Run the new focused auth/admin invite test file first.
- Run related invite/auth suites that cover shared admin invite behavior.
