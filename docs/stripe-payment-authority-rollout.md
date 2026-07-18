# Stripe payment-authority rollout gate

The hardened payment lifecycle must remain held until every existing Stripe-paid registration and team-fee recipient has a `stripeCharges` ledger, and every active Team Pass entitlement has a paid `teamPassCheckoutAttempts` authority record.

## Required pre-deploy audit

The audit callable must exist before the audit can run. After the PR's exact head has clean CI and independent security review, the only permitted bootstrap deployment is this callable by itself:

```sh
firebase deploy --only functions:auditStripePaymentAuthorityRollout \
  --project game-flow-c6311 \
  --account pauljsnider@gmail.com
```

Verify that `auditStripePaymentAuthorityRollout` is active before continuing. Do not include payment handlers, webhooks, Firestore rules, Hosting, or any other function in this bootstrap deployment. The callable only reads payment-authority records and writes its audit result to `paymentAuthorityRolloutAudits`; the PR remains held after bootstrap.

1. Call `auditStripePaymentAuthorityRollout` as a platform administrator with `{ "assertEmpty": false }`.
2. Review the durable audit entry written to `paymentAuthorityRolloutAudits` and resolve every returned blocker. This database currently contains test data, so legacy test payment records may be deleted through an explicitly reviewed administrative data operation; this callable never deletes or rewrites payment data.
3. Run the callable again with:

   ```json
   {
     "assertEmpty": true,
     "confirmation": "assert_no_legacy_stripe_payment_authority_v1"
   }
   ```

4. Capture the sanitized result fields (`ready`, `complete`, `asserted`, all scanned counts, and `blockerCount`) plus the audit document ID and timestamp. Do not copy user, payment, or Stripe identifiers into PR evidence.
5. Remove the hold and proceed with merge/deployment only when the callable returns `ready: true`, `complete: true`, `asserted: true`, and `blockerCount: 0`. A non-empty result throws `failed-precondition`; a scan exceeding the 10,000-document safety cap throws `resource-exhausted`. Either outcome keeps the rollout blocked, with only the audit callable left deployed for remediation and reruns.

The assertion is intentionally read-only apart from its audit log. It does not infer Stripe authority from client-visible balances and does not silently synthesize missing charge history.
