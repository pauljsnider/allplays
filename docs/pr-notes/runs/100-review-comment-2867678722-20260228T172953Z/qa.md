# QA Role Summary

## Regression Focus
- Parent invite failure path for email and Google signup.
- Ensure no profile write occurs when invite redemption throws.
- Ensure normal activation-code signup still succeeds.

## Test Evidence Required
1. Failure assertion on thrown error.
2. Negative assertion for `updateUserProfile` call count.
3. Cleanup assertions (`delete`, `signOut`).
4. Positive control: standard signup marks code used.
