# QA

## Focused regressions

1. Service phone-only rejection:
   - Call `createProfileAccessCode` with a phone and no email.
   - Assert actionable email guidance.
   - Assert no code generation, SDK write, or REST fallback.
2. Service email preservation:
   - Keep the existing email-only collision-safe creation test.
3. Profile phone-only rejection:
   - Enter only a phone and submit.
   - Assert guidance and no `createProfileAccessCode` call or generated result.
4. Profile email preservation:
   - Enter only email and submit.
   - Assert the normalized email/empty phone service call and success result.

## Focused command

```bash
cd apps/app
npx vitest run src/lib/profileService.test.ts src/pages/Profile.test.tsx --reporter=verbose
```

## Regression traps

- Never use profile phone data as proof of verified identity.
- UI-only blocking is bypassable; service enforcement is mandatory.
- Email-plus-phone remains allowed because email is the binding target.
- App tests must run from `apps/app` with its jsdom and jest-dom setup.
