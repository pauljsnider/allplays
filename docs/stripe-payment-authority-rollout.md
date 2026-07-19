# Stripe payment-authority rollout gate

The hardened payment lifecycle must remain held until every existing Stripe-paid registration and team-fee recipient has a `stripeCharges` ledger, and every active Team Pass entitlement has a paid `teamPassCheckoutAttempts` authority record.

## Required frozen cutover audit

The final assertion is valid only inside a verified payment-maintenance window. Writing the rollout control document alone does not start that window: the legacy deployed callables do not read it. A normal dry run is not a merge/deploy gate because a legacy checkout handler can create a Stripe Session before its Firestore projection, an old webhook can settle a record after its parent page was scanned, and an administrator can delete or rewrite a parent while the scan is running.

After the PR's exact head has clean CI and independent security review, use this ordering:

1. Before claiming or writing any freeze, generate a unique 16–128 character `freezeId` and inventory all seven intended payment-mutation callable names:

   - `createStripeRegistrationCheckout`
   - `cancelStripeRegistrationCheckout`
   - `createStripeTeamFeeCheckout`
   - `expireStripeTeamFeeCheckout`
   - `refundStripeTeamFeePayment`
   - `createStripeTeamPassCheckout`
   - `expireStripeTeamPassCheckout`

   Do not assume every name already exists: the two `expireStripe*` recovery callables may be new at cutover time. Enumerate the actual deployed generation, region, backing service, URI, and current IAM policy for every target. For an absent target, record a verified `NOT_DEPLOYED` entry in the manifest and ensure it remains absent during bootstrap. For every deployed target, save its full IAM policy, etag, and revision in a permission-restricted rollback manifest. Do not reuse a prior maintenance-window ID.
2. Announce maintenance, then establish transport quiescence before relying on the control document. Remove only the applicable Gen 1 `roles/cloudfunctions.invoker` or Gen 2 `roles/run.invoker` public grant from every deployed legacy payment-mutation target in the inventory. Verify each deployed transport returns HTTP 403 before callable code runs. Separately verify the webhook remains invokable and confirm any already-deployed audit or cleanup endpoint still has its intended access. Do not infer quiescence from an IAM command succeeding or treat a nonexistent function as an IAM success. This step blocks new callable entry but does not prove that earlier invocations drained, and the maintenance freeze is not active yet.
3. Only after every deployed legacy mutation callable is transport-blocked and the 403 evidence is recorded, create `paymentAuthorityRollout/control` with the exact new `freezeId` and `frozen: true` through an authenticated, audited administrator operation. Record the write time and exact document contents. Then deploy the reviewed Firestore rules while the IAM blocks remain in force. The control document is server-only and immutable to every client, including platform administrators. These rules freeze registration forms/records, Team Fee batches/recipients/offline billing, and Team Pass entitlement mutations while preserving safe reads and unrelated team operations. Verify the control readback, representative payment-write denials, and representative nonpayment reads/writes. Webhooks use Admin SDK, bypass rules, remain invokable, and must never be disabled during drainage. The verified maintenance window starts only after all three gates are simultaneously proven: mutation-callable transport denial, the exact server control, and the reviewed rules freeze. Do not run either rollout callable or accept audit evidence before that point.
4. Bootstrap only the two reviewed rollout callables while all three freeze gates remain active:

```sh
firebase deploy --only \
  functions:auditStripePaymentAuthorityRollout,functions:expireOpenStripePaymentAuthoritySessionsForRollout \
  --project game-flow-c6311 \
  --account pauljsnider@gmail.com
```

Verify both exact functions are active before continuing. Do not include payment handlers, webhooks, Hosting, or any other function in this bootstrap deployment. The PR remains held after bootstrap.

5. Call `auditStripePaymentAuthorityRollout` as a platform administrator with `{ "assertEmpty": false }`.
6. The audit is bidirectional. It checks parent records, orphan/nonscoped `stripeCharges`, every Team Pass attempt, active entitlements, registration creation pointers, and relevant open/complete Stripe Checkout Sessions. For every settled Session it retrieves the exact PaymentIntent and latest Charge, then requires the durable ledger or Team Pass attempt to match the Session, PaymentIntent, Charge, amount, currency, livemode, scope, and current refund/dispute evidence. Any incomplete page, pointer-only creation, in-flight/disputed attempt, orphan ledger, settled Session without exact economic authority, or open relevant Session blocks the cutover.
7. First call `expireOpenStripePaymentAuthoritySessionsForRollout` with `{ "dryRun": true }`. Review `complete`, `scanned`, `matched`, `bindingFailureCount`, `liveModeMatched`, and `testModeMatched`. The callable targets only Sessions returned by the authenticated Stripe account that also pass exact product metadata, scope, mode, client-reference, and configured-livemode binding. It never expires an unrelated or binding-invalid Session.
8. After reviewing the dry run, call it again with:

   ```json
   {
     "dryRun": false,
     "confirmation": "expire_open_legacy_stripe_checkout_sessions_v1",
     "freezeId": "<exact active freezeId>"
   }
   ```

   This intentionally expires only open Checkout Sessions recognizable as registration, Team Fee, modern Team Pass, or legacy Team Pass payment flows. The callable binds the operation to the control document's immutable Firestore update version, rechecks it before and after every Stripe list page and every individual expiration, and rechecks once more before recording success. If the control is cleared or rewritten—even with the same `freezeId`—the operation stops before the next expiration and does not write a success log. Inspect its durable log and require `complete: true`, `failureCount: 0`, and `expired == matched`. A failure keeps the freeze and IAM blocks in place.
9. Drainage is evidence-based, not a fixed sleep: require no recognized open or complete-unpaid Checkout Sessions, no in-flight/recovering payment authority, no retryable recognized webhook/event failures, and matching durable authority for every recognized settled Session. Wait through at least one webhook retry/requery interval, query again, and require the same empty result twice. Re-run the dry audit until all criteria hold. This database currently contains test data, so legacy test payment records may be deleted only through an explicitly reviewed administrative data operation.
10. Run the callable again with:

   ```json
   {
     "assertEmpty": true,
     "confirmation": "assert_no_legacy_stripe_payment_authority_v1",
     "freezeId": "<exact active freezeId>"
   }
   ```

11. The asserted audit binds to both the exact `freezeId` and the control document's immutable Firestore update version. It rechecks that exact freeze epoch before and after every Stripe/Firestore page and after each inspection batch, then fails if the control is absent, cleared, or rewritten—even if an operator restores the same ID. Capture the sanitized result fields (`ready`, `complete`, `asserted`, all scanned counts, and `blockerCount`) plus the audit document ID, freeze ID, `freezeControlVersion`, and timestamp. Do not copy user, payment, or Stripe identifiers into PR evidence.
12. While the IAM block, exact control, and rules freeze still hold, merge the exact reviewed head and deploy the hardened payment handlers/webhook. Every new mutation handler independently checks the frozen control and returns maintenance/unavailable before changing authority. Re-check effective IAM and control state before and after deployment; if deployment restored a public grant, remove it again before continuing.
13. Verify every deployed handler revision. While `frozen: true`, restore the exact pre-freeze callable invoker grants only for targets that existed in the saved manifest. For a newly created `expireStripeTeamFeeCheckout` or `expireStripeTeamPassCheckout`, apply a separately reviewed callable invoker policy matching the intended client transport and record that new policy; there is no pre-freeze policy to restore. Confirm every now-invokable hardened mutation callable still rejects payment mutation because of the control document. Run the explicit empty assertion again after all intended invoker policies are active. Only after that post-deploy assertion is clean may the operator clear `paymentAuthorityRollout/control.frozen` as the final reopening step. Verify a new checkout and each required expiration/recovery flow use durable v2 authority before considering the cutover complete.

Do not call the ordering atomic. IAM changes, control creation, rules deployment, Functions deployment, webhook drainage, assertion, and reopening are separate observable steps. Safety comes from blocking legacy callable transport before declaring the freeze, then keeping the callable IAM block, exact control, and Firestore rules freeze in force across every later gap, verifying each transition, and repeating the assertion after hardened code is deployed.

This procedure intentionally makes online checkout, cancellation, recovery, and refunds temporarily unavailable. Retain the IAM/control rollback manifests. If any verification fails before hardened handlers are deployed, keep the legacy mutation-callable public grants removed; the control document cannot make those old revisions safe. Restore a mistakenly changed webhook or other non-mutation policy from its saved manifest, but never reopen old mutation handlers to work around a blocked audit. If the operator explicitly aborts the maintenance window and returns to the prior release, that is a separate reviewed rollback: reconcile all observed Stripe/Firestore activity, restore the prior rules and control state, verify the prior release, and restore legacy mutation invoker grants last. After hardened handlers are deployed and verified to enforce the exact control, their intended invoker policies may be restored as described in step 13 while `frozen: true`.

Remove the hold and proceed only when the pre-merge frozen assertion returns `ready: true`, `complete: true`, `asserted: true`, and `blockerCount: 0`. A non-empty result throws `failed-precondition`; a scan exceeding a 10,000-document safety cap throws `resource-exhausted`. Either outcome keeps the rollout blocked.

The assertion is intentionally read-only apart from its audit log. It does not infer Stripe authority from client-visible balances and does not silently synthesize missing charge history.
