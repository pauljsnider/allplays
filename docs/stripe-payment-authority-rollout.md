# Stripe payment-authority rollout gate

The hardened payment lifecycle must remain held until every existing Stripe-paid registration and team-fee recipient has a `stripeCharges` ledger, and every active Team Pass entitlement has a paid `teamPassCheckoutAttempts` authority record.

## Required frozen cutover audit

The final assertion is valid only inside a verified payment-maintenance window. A normal dry run is not a merge/deploy gate: the legacy checkout handlers can create a Stripe Session before their Firestore projection, old webhooks can settle a record after its parent page was scanned, and an administrator can delete or rewrite a parent while the scan is running.

After the PR's exact head has clean CI and independent security review, use this ordering:

1. Generate a unique 16–128 character `freezeId`, then create `paymentAuthorityRollout/control` with that exact `freezeId` and `frozen: true` through an authenticated, audited administrator operation. Record the write time and exact document contents. Do not reuse a prior maintenance-window ID.
2. Inventory all seven intended payment-mutation callable names before scanning:

   - `createStripeRegistrationCheckout`
   - `cancelStripeRegistrationCheckout`
   - `createStripeTeamFeeCheckout`
   - `expireStripeTeamFeeCheckout`
   - `refundStripeTeamFeePayment`
   - `createStripeTeamPassCheckout`
   - `expireStripeTeamPassCheckout`

   Do not assume every name already exists: the two `expireStripe*` recovery callables may be new at cutover time. Enumerate the actual deployed generation, region, backing service, URI, and current IAM policy for every target. For an absent target, record a verified `NOT_DEPLOYED` entry in the manifest and ensure it remains absent during bootstrap. For every deployed target, save its full IAM policy, etag, and revision in a permission-restricted rollback manifest, then remove only the applicable Gen 1 `roles/cloudfunctions.invoker` or Gen 2 `roles/run.invoker` public grant. Verify each deployed transport now returns HTTP 403 before callable code runs. Separately verify the webhook, audit, and cleanup endpoints remain invokable. Do not infer quiescence from an IAM command succeeding or treat a nonexistent function as an IAM success.
3. Deploy the reviewed Firestore rules while `frozen: true`. The control document is server-only and immutable to every client, including platform administrators. These rules freeze registration forms/records, Team Fee batches/recipients/offline billing, and Team Pass entitlement mutations while preserving safe reads and unrelated team operations. Verify representative payment writes are denied and representative nonpayment reads/writes still work. Webhooks use Admin SDK, bypass rules, remain invokable, and must never be disabled during drainage.
4. Bootstrap only the two reviewed rollout callables:

```sh
firebase deploy --only \
  functions:auditStripePaymentAuthorityRollout,functions:expireOpenStripePaymentAuthoritySessionsForRollout \
  --project game-flow-c6311 \
  --account pauljsnider@gmail.com
```

Verify both exact functions are active before continuing. Do not include payment handlers, webhooks, Hosting, or any other function in this bootstrap deployment. The PR remains held after bootstrap.

5. Call `auditStripePaymentAuthorityRollout` as a platform administrator with `{ "assertEmpty": false }`.
6. The audit is bidirectional. It checks parent records, orphan/nonscoped `stripeCharges`, every Team Pass attempt, active entitlements, registration creation pointers, and relevant open/complete Stripe Checkout Sessions. Any incomplete page, pointer-only creation, in-flight/disputed attempt, orphan ledger, settled Session without durable authority, or open relevant Session blocks the cutover.
7. First call `expireOpenStripePaymentAuthoritySessionsForRollout` with `{ "dryRun": true }`. Review `complete`, `scanned`, `matched`, `bindingFailureCount`, `liveModeMatched`, and `testModeMatched`. The callable targets only Sessions returned by the authenticated Stripe account that also pass exact product metadata, scope, mode, client-reference, and configured-livemode binding. It never expires an unrelated or binding-invalid Session.
8. After reviewing the dry run, call it again with:

   ```json
   {
     "dryRun": false,
     "confirmation": "expire_open_legacy_stripe_checkout_sessions_v1",
     "freezeId": "<exact active freezeId>"
   }
   ```

   This intentionally expires only open Checkout Sessions recognizable as registration, Team Fee, modern Team Pass, or legacy Team Pass payment flows. Inspect its durable log and require `complete: true`, `failureCount: 0`, and `expired == matched`. A failure keeps the freeze and IAM blocks in place.
9. Drainage is evidence-based, not a fixed sleep: require no recognized open or complete-unpaid Checkout Sessions, no in-flight/recovering payment authority, no retryable recognized webhook/event failures, and matching durable authority for every recognized settled Session. Wait through at least one webhook retry/requery interval, query again, and require the same empty result twice. Re-run the dry audit until all criteria hold. This database currently contains test data, so legacy test payment records may be deleted only through an explicitly reviewed administrative data operation.
10. Run the callable again with:

   ```json
   {
     "assertEmpty": true,
     "confirmation": "assert_no_legacy_stripe_payment_authority_v1",
     "freezeId": "<exact active freezeId>"
   }
   ```

11. The asserted audit reads the exact `freezeId` before and after every Stripe/Firestore scan and fails if the maintenance window is absent or replaced. Capture the sanitized result fields (`ready`, `complete`, `asserted`, all scanned counts, and `blockerCount`) plus the audit document ID, freeze ID, and timestamp. Do not copy user, payment, or Stripe identifiers into PR evidence.
12. While the IAM and rules freeze still hold, merge the exact reviewed head and deploy the hardened payment handlers/webhook. Every new mutation handler independently checks the frozen control and returns maintenance/unavailable before changing authority. Re-check effective IAM and control state before and after deployment; if deployment restored a public grant, remove it again before continuing.
13. Verify every deployed handler revision. While `frozen: true`, restore the exact pre-freeze callable invoker grants only for targets that existed in the saved manifest. For a newly created `expireStripeTeamFeeCheckout` or `expireStripeTeamPassCheckout`, apply a separately reviewed callable invoker policy matching the intended client transport and record that new policy; there is no pre-freeze policy to restore. Confirm every now-invokable hardened mutation callable still rejects payment mutation because of the control document. Run the explicit empty assertion again after all intended invoker policies are active. Only after that post-deploy assertion is clean may the operator clear `paymentAuthorityRollout/control.frozen` as the final reopening step. Verify a new checkout and each required expiration/recovery flow use durable v2 authority before considering the cutover complete.

Do not call the ordering atomic. IAM changes, rules deployment, Functions deployment, webhook drainage, assertion, and reopening are separate observable steps. Safety comes from keeping both the callable IAM block and Firestore rules freeze in force across every gap, verifying each transition, and repeating the assertion after hardened code is deployed.

This procedure intentionally makes online checkout, cancellation, recovery, and refunds temporarily unavailable. Announce the maintenance window, retain the IAM/control rollback manifests, and if any verification fails restore the last known-safe IAM policy while keeping `frozen: true`; never reopen old mutation handlers to work around a blocked audit.

Remove the hold and proceed only when the pre-merge frozen assertion returns `ready: true`, `complete: true`, `asserted: true`, and `blockerCount: 0`. A non-empty result throws `failed-precondition`; a scan exceeding a 10,000-document safety cap throws `resource-exhausted`. Either outcome keeps the rollout blocked.

The assertion is intentionally read-only apart from its audit log. It does not infer Stripe authority from client-visible balances and does not silently synthesize missing charge history.
