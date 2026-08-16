# Public registration abuse-control rollout

This change keeps staged abuse controls in observation mode by default. Registration guardian-email readback is a fixed ownership boundary and always requires a verified email claim. The existing per-form, per-guardian, per-network submission limit remains enforced at three attempts per ten minutes. No production data migration is required.

## Covered entry points and trust boundaries

| Entry point | Authentication | Protection after this change |
| --- | --- | --- |
| `submitPublicRegistration` | Public; optional Firebase Auth | Verified App Check observation/enforcement; durable subject limit; staged durable network and form limits; 1 MiB serialized-request and field limits; server-owned pricing/capacity; replay-safe submission keys; authenticated UID attribution |
| `createStripeRegistrationCheckout` | Public capability or legacy checkout-attempt token | Existing server-owned registration/payment/capacity validation plus a 1 MiB serialized-request limit and staged App Check and durable subject/network/form limits |
| `cancelStripeRegistrationCheckout` | Public capability or legacy checkout-attempt token | Existing capability and capacity-release transaction plus a 1 MiB serialized-request limit and staged App Check and durable subject/network/form limits |
| `stripeTeamPassWebhook` registration events | Stripe-signed HTTP request | Exempt from App Check because Stripe cannot provide it; signature verification, event ledger/idempotency, and its existing IP limit remain mandatory |
| Published registration-form reads | Anonymous Firestore read | Only published forms are readable; registrations remain server-write-only |
| Registration readback | Signed-in Firestore read | Authoritative submitter UID is accepted independently. Email-based ownership always requires a verified current Auth email matching the normalized guardian email. |

Raw `X-Firebase-AppCheck` headers are never trusted. Only the callable context populated after Firebase verifies a token counts as App Check. Rate-limit documents contain only SHA-256 document IDs, counts, reset timestamps, and TTL timestamps; email addresses, tokens, and IP addresses are not persisted or logged.

## Modes and thresholds

Each staged setting accepts `disabled`, `observe`, or `enforce`. Missing and invalid values safely resolve to `observe`.

| Runtime setting | Default | Window and threshold |
| --- | --- | --- |
| `public_registration.app_check_mode` | `observe` | Missing verified App Check is logged; enforcement rejects before reads/writes |
| `public_registration.network_rate_limit_mode` | `observe` | Submit: 30 per form/IP/10 min; checkout/cancel: 60 per form/IP/10 min |
| `public_registration.form_rate_limit_mode` | `observe` | Submit: 250 per form/app-verification-state/10 min; checkout/cancel: 500 |
| `public_registration.checkout_rate_limit_mode` | `observe` | 120 target lookups per client network/operation/10 min before resolution, then 12 per proven checkout capability or attempt token/10 min |

The equivalent process-environment names are `PUBLIC_REGISTRATION_APP_CHECK_MODE`, `PUBLIC_REGISTRATION_NETWORK_RATE_LIMIT_MODE`, `PUBLIC_REGISTRATION_FORM_RATE_LIMIT_MODE`, and `PUBLIC_REGISTRATION_CHECKOUT_RATE_LIMIT_MODE`. Process environment takes precedence over Functions runtime configuration.

## Ordered rollout

1. Deploy the functions and clients with every staged abuse-control setting in `observe`. Deploy Firestore rules in the same release or first; guardian-email registration ownership requires a verified current Auth email regardless of verified-email policy state.
2. Confirm web, iOS, and Android clients report healthy App Check token acquisition. Exercise one free/offline registration, one paid registration through Stripe redirect, one cancelled checkout retry, and one exact network retry. The exact retry must return the same registration ID and reserve capacity once.
3. Monitor at least one normal registration cycle. Cloud Logging events are `public_registration_app_check_missing`, `public_registration_rate_limit_exceeded`, and `public_registration_rate_limit_error`. Group by `operation`, `scope`, and `mode`; no applicant identifiers should appear.
4. Enable checkout rate enforcement first, then network enforcement. Change only one mode per deploy and repeat the canary matrix after each change.
5. Enable form-wide enforcement only after peak-volume observations prove 250 submissions and 500 checkout operations per ten minutes leave sufficient headroom. A form-wide limit is a last-resort distributed-abuse brake and can also be exhausted intentionally, so keep it in observe if the risk outweighs the benefit.
6. Enable App Check last, only after the healthy-token rate is acceptable for every supported client version and debug/test clients have registered debug tokens.
7. For email-based registration readback, validate that verification plus Auth token refresh restores access. Registrations submitted by a signed-in user remain readable by that same UID independently of email verification or a later email change. The staged verified-email policy still governs unrelated workflows, not registration ownership.

Example runtime configuration (requires a functions deploy to take effect):

```sh
firebase functions:config:set \
  public_registration.app_check_mode=observe \
  public_registration.network_rate_limit_mode=observe \
  public_registration.form_rate_limit_mode=observe \
  public_registration.checkout_rate_limit_mode=observe \
  --project game-flow-c6311
```

## Canary assertions

- A request with no verified App Check succeeds in `observe` and produces an observation event.
- The same request fails with `reason=app-check-required` in `enforce`; a verified request succeeds.
- Changing a raw App Check header never changes a subject/network boundary.
- Oversized or semantically invalid submissions fail before any attacker-keyed limiter document is written.
- Retrying the same `submissionIdempotencyKey` and payload returns the same registration ID with `idempotentReplay=true`; capacity and durable-rate counters do not increment again.
- Reusing the key with changed participant, guardian, option, plan, quantity, or checkout token fails with `reason=idempotency-conflict`.
- Anonymous clients can read a published form but cannot write a registration document directly.
- In missing, disabled, observe, and enforce verified-email policy states, an unverified matching email cannot read a registration, a verified matching email can, a different email cannot, and the authoritative submitting UID can.

## Rollback

1. Set the affected mode to `observe` (preferred) or `disabled` and redeploy functions. This immediately restores legacy request behavior while retaining or stopping measurement respectively.
2. Do not use `securityPolicies/verifiedEmail.mode` to relax registration ownership. If readback is affected, confirm email verification and Auth token refresh first; preserve authoritative submitter-UID access while diagnosing.
3. Do not delete `publicRegistrationRateLimits` during rollback. TTL removes expired records, and deleting live windows would reopen an abuse window.
4. Client idempotency fields are additive. Older clients remain supported, so client rollback does not require server rollback or data cleanup.
5. If the function release itself must be reverted, keep the Firestore rule that denies public registration writes. Revert functions before clients only after confirming old clients do not depend on `idempotentReplay` (current clients ignore the additive field).
