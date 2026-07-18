# Stripe payment-authority rollout gate

The hardened payment lifecycle must remain held until every existing Stripe-paid registration and team-fee recipient has a `stripeCharges` ledger, and every active Team Pass entitlement has a paid `teamPassCheckoutAttempts` authority record.

## Required pre-deploy audit

1. Call `auditStripePaymentAuthorityRollout` as a platform administrator with `{ "assertEmpty": false }`.
2. Review the durable audit entry written to `paymentAuthorityRolloutAudits` and resolve every returned blocker. This database currently contains test data, so legacy test payment records may be deleted through an explicitly reviewed administrative data operation; this callable never deletes or rewrites payment data.
3. Run the callable again with:

   ```json
   {
     "assertEmpty": true,
     "confirmation": "assert_no_legacy_stripe_payment_authority_v1"
   }
   ```

4. Proceed only when the callable returns `ready: true`, `complete: true`, and `blockerCount: 0`. A non-empty result throws `failed-precondition`; a scan exceeding the 10,000-document safety cap throws `resource-exhausted`. Either outcome keeps the rollout blocked.

The assertion is intentionally read-only apart from its audit log. It does not infer Stripe authority from client-visible balances and does not silently synthesize missing charge history.
