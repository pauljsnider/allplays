# Code Plan

## Minimal Patch Plan
1. Cherry-pick PR #1906's focused privacy fix onto a clean branch.
2. Keep parent-safe fee updates on `feeRecipients/{recipientId}` and move private metadata into `adminBilling`.
3. Preserve idempotency and stale-session guards in webhook/refund handling.
4. Add focused coverage for parent sanitization, fee helper output split, and rules CI enforcement of the new `adminBilling` stanza.

## Test Additions Needed
- Parent fee sanitization assertions in `tests/unit/parent-dashboard-fees.test.js`.
- Helper assertions for `adminBilling` split in `tests/unit/team-fees-functions.test.js`.
- Rules CI assertion for `match /adminBilling/{billingId}` and owner/admin-only access in `scripts/validate-firebase-rules-ci.mjs`.

## Known Validation Blockers
- No emulator-backed Firestore access test in this slice.
- No real browser payment/refund smoke in this slice.

## Recommended Commands
```bash
cd /tmp/allplays-issue-1901-20260606T102637Z
npm install
npx vitest run tests/unit/team-fees-functions.test.js tests/unit/parent-dashboard-fees.test.js --reporter=dot
npx vitest run tests/unit/app-team-fees-service.test.ts tests/unit/app-parent-tools-service.test.js --reporter=dot
npm run ci:firebase-rules
git diff --check
```
