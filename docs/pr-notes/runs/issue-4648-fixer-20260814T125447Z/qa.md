# Risk Matrix

- High: 499 must produce exactly 500 writes; 500+ must reject before allocation.
- High: whitespace variants and duplicates must count once.
- Medium: React must show the bounded error without success/navigation and remain retryable.
- Medium: Legacy must preserve state, restore controls, and remain retryable.
- Low: Existing small-roster, installment, manual, and Stripe flows.

# Automated Tests To Add/Update

- DB: 499 success, 500 zero-allocation rejection, blank filtering, duplicate normalization.
- App service: 499 whole-roster pass-through, 500 rejection, duplicate roster rows.
- Legacy: shared limit and duplicate normalization through draft validation.
- React: oversized whole-roster error, no success/navigation, retained values, re-enabled retry.

# Manual Test Plan

Submit 500 and then 499 recipients in React/Capacitor and legacy. Verify the bounded error and zero records at 500, then one batch plus 499 recipients after retry. Verify duplicate IDs create one recipient document.

# Negative Tests

- 500 and 501 distinct IDs reject.
- 500 raw entries normalizing to 499 succeed.
- Blank IDs do not count.
- Offline and Stripe drafts share the boundary.
- Rejected UI submissions do not clear, navigate, show success, or remain disabled.

# Release Gates

- `npx vitest run tests/unit/db-team-fee-recipient-updates.test.js tests/unit/team-fees-admin.test.js tests/unit/app-team-fees-service.test.ts --reporter=verbose`
- `npm run test:app -- src/pages/TeamFees.test.tsx`
- `node scripts/check-critical-cache-bust.mjs`
- GitHub CI remains the full gate.

# Post-Deploy Checks

Confirm the exact merge SHA passes production deployment and smoke checks. With bounded non-production data, verify zero documents at 500 and exactly 500 total documents at 499, including duplicate-ID behavior.
