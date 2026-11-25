# QA Analysis

## Regression target

Exercise `updateTeamFeeRecipient` directly. The Playwright team-fees harness stubs this database function, so it cannot prove transactional reconciliation.

## Required regression

Submit a stale adjustment payload computed from $100 while the transaction reads a current $80 balance. A positive $10 adjustment must persist $70, not the client-provided $90. Assert:

- authoritative top-level amount due, remaining balance, and status;
- authoritative nested adjustment before/after values;
- reconciled ledger and private admin-billing values;
- audit fields from values actually written;
- no non-transactional `updateDoc` or `setDoc` path.

Preserve coverage for negative adjustments, paid-recipient status derivation, zero-floor credits, invalid deltas, checkout invalidation, and private-field sanitization.

## Focused validation

```bash
npx vitest run tests/unit/db-team-fee-recipient-updates.test.js tests/unit/team-fees-admin.test.js --reporter=verbose
node scripts/check-critical-cache-bust.mjs
git diff --check
```
