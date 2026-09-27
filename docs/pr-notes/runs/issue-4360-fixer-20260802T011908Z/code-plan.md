# Code Plan

Base SHA: `1604c95f66ced0086c8509976ddf0a4a69203e0c`

## Exact edits

- `firestore.rules`: centralize server-owned checkout fields; reject them on client create or any affected-key update while preserving identity, authorization, and audit guards.
- `functions/team-fees-core.cjs`: add non-throwing canonical URL and reuse/fresh-session validation helpers; export them for deterministic tests.
- `functions/index.js`: retrieve a reuse candidate from Stripe, classify safe replacement versus fail-closed outcomes, validate new sessions before persistence, and retain transactional revalidation/audit behavior.
- `tests/unit/team-fee-recipient-rules.test.js`: add per-field/per-actor emulator denials plus owner/admin compatibility controls.
- `tests/unit/team-fees-functions.test.js`: add URL and session binding matrices, including malformed legacy token behavior.
- `functions/test/team-fee-checkout-callable.test.cjs`: add an existing-style module-stub harness for valid reuse, safe stale replacement, ambiguous/active poison failures, and unsafe fresh response rejection.

## Helper contracts

- `isCanonicalStripeCheckoutUrl(value)`: exact HTTPS Stripe Checkout origin, no credentials or explicit port, nonempty path, never throws.
- `getTeamFeeCheckoutReuseFailure({ recipient, session, input, amountCents })`: empty string only for a live, fully bound reusable session; otherwise stable reason, never throws on legacy data.
- `getNewTeamFeeCheckoutSessionFailure({ session, input, checkoutAttemptToken, amountCents })`: validates provider identity, destination, open/unpaid state, amount, and metadata before persistence/return.

## Ordered implementation

1. Add failing pure, rules, and callable regressions.
2. Implement safe token inspection and validation helpers.
3. Tighten Firestore guards.
4. Wire live Stripe retrieval, recovery classification, and fresh-session validation.
5. Run the three focused commands and review the exact diff for production-safety invariants.
