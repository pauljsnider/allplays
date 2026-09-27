# Architecture

## Evidence

- `Profile.tsx` accepts email or phone and calls `createProfileAccessCode`.
- `profileService.ts` accepts either value and writes through the SDK or native REST fallback.
- `AuthUser` has verified email state but no verified phone identity, and the configured sign-in entry points do not provide Phone Auth.
- A profile phone field is editable contact data, not a trusted authentication claim.

## Minimal safe design

1. Define one shared phone-only invite error/validator at the app service boundary.
2. Reuse it in the Profile form for immediate guidance and no-submit behavior.
3. Enforce it again before code generation and both persistence paths.
4. Preserve email-only and email-plus-phone payloads unchanged.
5. Do not change redemption, Firestore rules, auth providers, or historical records.

## Safety review

- Authorization/privacy: applicable. Creation fails closed when no verifiable recipient identity exists.
- Partial failure: applicable. Rejected input starts neither SDK nor REST persistence.
- Atomicity, idempotency, interrupted browser, retention, and deletion: not materially changed.
- Blast radius: new React Profile invite creation on web and Capacitor only. Existing invite history and email-targeted invites are unchanged.
- Rollback: revert the validation/UI guard; no migration or data rewrite exists.

## Residual risk

Old packaged clients or direct writers are outside this client slice. Redemption must remain fail closed. Centralized validation keeps recurrence risk low until verified phone authentication is deliberately added end to end.
