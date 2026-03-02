# Code Role (manual fallback)

## Minimal patch plan
1. In `js/signup-flow.js`, after successful `redeemAdminInviteAcceptance(...)`, add `updateUserProfile(userId, { email, createdAt: new Date(), emailVerificationRequired: true })`.
2. Preserve existing catch-path cleanup and rethrow semantics.
3. Update `tests/unit/signup-flow.test.js`:
   - Assert admin invite signup writes baseline profile fields.
   - Add test: admin invite redemption failure performs cleanup and rethrows.
