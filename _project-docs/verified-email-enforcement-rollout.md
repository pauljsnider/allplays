# Verified email enforcement rollout

## Why enforcement is staged

Password users currently create their private `users/{uid}` profile and may redeem an invite before clicking the verification link. Denying every authenticated write immediately would strand new users before they can finish verification or recovery. This rollout therefore separates account bootstrap/recovery from sensitive product mutations and starts in `observe` mode.

The bootstrap exceptions are intentional:

- create/update of the caller's own non-privileged `users/{uid}` profile;
- email-verification and password-reset delivery;
- invite redemption/failed-signup cleanup paths needed to complete or recover an account;
- authentication methods without an email claim, such as phone-only sign-in.

All exceptions retain their existing ownership, payload, expiry, and privilege-field checks. They are not blanket write access.

## Shared policy

Firestore and Storage read `securityPolicies/verifiedEmail`:

```json
{
  "mode": "observe",
  "exemptUserIds": [],
  "updatedAt": "server timestamp",
  "updatedBy": "admin uid",
  "rolloutNote": "optional, 500 characters maximum"
}
```

Valid modes are `disabled`, `observe`, and `enforce`. A missing document behaves as `observe` for Cloud Functions and as current allow behavior for rules. Only a global admin can read or change the document, and rules validate its shape.

Cloud Functions also support `VERIFIED_EMAIL_SENSITIVE_WRITES_MODE`. A deploy-time value of `enforce` is a fail-closed backstop: the Firestore document cannot downgrade it. Keep the deploy-time value at `observe` during migration, then set both controls to `enforce` for the final cutover.

Temporary exemptions may be supplied through the policy's bounded `exemptUserIds` list or the server-issued boolean custom claim `email_verification_exempt`. Do not use either as a permanent substitute for verification. Remove exemptions after the user verifies.

## Covered sensitive actions

The staged server guard covers registration-provider synchronization, organization schedule publishing, officiating claims, invite email sending, account-merge preview/confirmation, household access revocation, scoped RSVP token creation, authenticated Stripe checkout/refund operations, shared-game cancellation notices, team email, and authorized direct messages. Public opportunity publishing already requires a verified token independently.

Firestore rules gate authenticated social/public-profile mutations, friendship/report writes, incentives and private AI data, household/account-merge requests, invite creation/deletion, athlete profiles, drill publishing, team creation/privilege changes, direct auth-only assignment/chat/RSVP/rideshare writes, and family-share token management. Storage gates every supported upload and deletion while leaving reads unchanged.

## Rollout checklist

1. Deploy code and rules with no `enforce` setting. Confirm ordinary signup, invite redemption, team management, messaging, calendar import, and native/web sessions still work.
2. Create the policy in `observe` mode. Keep the deploy-time mode at `observe`.
3. Review `unverified_email_sensitive_action` logs by operation. Identify legitimate unverified password accounts and prompt them to verify; do not copy email addresses into logs or the policy.
4. Add only time-bounded legacy UID exemptions that cannot be migrated before cutover. Record the reason in the change ticket, not in the public app.
5. Verify email-verification resend, refresh-token/reload behavior, password reset, invite redemption, phone-only auth, and one web plus one native session.
6. In a preview/emulator environment, set the policy to `enforce` and run the full rules, functions, unit, and authenticated smoke suites. Confirm unverified sensitive writes receive `failed-precondition` while reads and bootstrap/recovery still work.
7. Set the production policy to `enforce`, monitor failures, and keep an authenticated global-admin break-glass path available to return the policy to `observe`.
8. After a stable observation window, deploy `VERIFIED_EMAIL_SENSITIVE_WRITES_MODE=enforce` as the fail-closed backstop. Remove temporary exemptions on a dated schedule.

## Rollback

Before the deploy-time backstop is enabled, a global admin can set the policy back to `observe`. After the environment backstop is `enforce`, rollback requires deploying it as `observe` or `disabled`; changing only the Firestore policy cannot weaken it. Account bootstrap and verification delivery remain available during either rollback path.
