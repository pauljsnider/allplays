# QA Strategy

Base SHA: `1604c95f66ced0086c8509976ddf0a4a69203e0c`

## Firestore emulator matrix

For each protected field independently, assert denied create, add/change, null, and delete attempts for owner, admin, linked parent, and unrelated user. Positive controls prove owner/admin clean creation, audited balance/status updates, and unrelated authorized updates on legacy documents remain allowed.

Protected coverage includes checkout destinations, checkout status/token/amount/timestamps, payment-provider lifecycle state, and Stripe/session identifiers. Each denial uses a separate write so one guard cannot mask another missing guard.

## URL and session matrix

Accept canonical `https://checkout.stripe.com/...` only. Reject HTTP, malformed and relative values, credentials, explicit ports, non-Stripe HTTPS, subdomains, and suffix-confusion hosts. Validate persisted/session URL equality plus session ID, mode, status, payment status, amount, token, product, team, batch, recipient, and metadata amount.

## Callable cases

- Valid live session retrieves once, creates zero, writes zero, and returns the validated URL.
- Definitively expired/missing session creates one validated replacement.
- Active poisoned/mismatched session and ambiguous retrieval failure fail closed without create.
- Unsafe or mismatched fresh Stripe response fails before Firestore write.

## Focused commands

```bash
npx vitest run tests/unit/team-fees-functions.test.js --reporter=verbose
node --test functions/test/team-fee-checkout-callable.test.cjs
npx firebase emulators:exec --only firestore --project demo-allplays "npx vitest run tests/unit/team-fee-recipient-rules.test.js --reporter=verbose --no-file-parallelism"
```

Running the rules test without the emulator is a false green because engine coverage is skipped. Source-string assertions alone do not prove callable behavior.
