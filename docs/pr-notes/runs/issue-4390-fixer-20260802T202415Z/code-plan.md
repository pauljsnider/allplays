# Code plan

## Root cause

UI and service validation treated editable phone data like a trusted Auth identity, but supported sign-in flows provide no verified phone claim.

## Patch

1. Add a shared phone-only capability validator and enforce it in `profileService.ts` before code generation or persistence.
2. Reuse it in `Profile.tsx` so phone-only submission never calls the service.
3. Guide the user to enter the recipient's email.
4. Preserve email-only and email-plus-phone invites.
5. Add component regressions for blocked phone-only and successful email-only submissions.
6. Add a service regression proving zero generation or persistence calls for phone-only input.
7. Update the native REST fallback test to remain email-targeted.

## Validation

```bash
npm run test:app -- src/lib/profileService.test.ts src/pages/Profile.test.tsx --reporter=verbose
```
