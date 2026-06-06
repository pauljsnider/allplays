# QA

## QA Plan
- Validate parent-readable fee docs no longer retain Stripe and admin-only fields after checkout/refund writes.
- Validate `adminBilling` is the only storage path for private reconciliation metadata.
- Validate parent dashboard and app parent-tools service consume sanitized fee models.
- Validate fee status, balance, and refund math still behave correctly.

## Test Matrix
- Parent fee helper sanitization.
- Team fee function helper paid/refund output split.
- App fee service path using shared parent fee normalization.
- Firestore rules CI coverage for the `adminBilling` rule stanza.

## Highest-Risk Regressions
1. Missing or weakened `adminBilling` rule coverage.
2. Legacy ledger aliases leaking private fields.
3. Admin tools expecting top-level Stripe identifiers.
4. Refund accounting drift in partial/full refund scenarios.

## Minimum Validation Commands
```bash
cd /tmp/allplays-issue-1901-20260606T102637Z
npx vitest run tests/unit/team-fees-functions.test.js tests/unit/parent-dashboard-fees.test.js --reporter=dot
npx vitest run tests/unit/app-team-fees-service.test.ts tests/unit/app-parent-tools-service.test.js --reporter=dot
npm run ci:firebase-rules
git diff --check
```

## Remaining Gap
- No emulator-backed parent-vs-admin rule test was added in this slice.
