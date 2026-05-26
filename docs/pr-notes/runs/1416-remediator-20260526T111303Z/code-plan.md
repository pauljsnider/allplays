# Code Plan

- Update VerifyPending.checkVerificationAndContinue to ignore reloadCurrentUser's boolean for navigation decisions.
- Use the AuthUser returned by auth.refresh for emailVerified check and getRouteForUser.
- Update unit test mocks to return refreshed users and add stale reload regression coverage.
- Run targeted Vitest file and app TypeScript/build validation.
