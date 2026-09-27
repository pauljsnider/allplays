# Risk Matrix

| Risk | Level | Gate |
|---|---|---|
| React still triggers private per-recipient reads | High | 100-recipient DB test with zero `getDoc` calls |
| Legacy hydration or refund eligibility regresses | High | Default-loader unit test plus focused legacy smoke |
| Parent-safe mapping or actions regress | Medium | Service and 100-recipient component tests |
| Cache-bust chain is incomplete | Medium | Critical cache-bust guard |
| Rules, Stripe, or schema drift | Low | Final diff review |

# Automated Tests To Add/Update

- DB loader: 100 flagged recipients, one query, zero detail reads; retain default hydration.
- React service: exact lightweight option plus status, balances, checkout state, and ledger mapping.
- React page: 100 recipients without `adminBilling`, exact totals, and one expanded action set.
- Legacy smoke: hydrated reconciliation note and online-refund controls remain visible.

# Manual Test Plan

With emulator logs, open 50 flagged recipients in React and verify zero `adminBilling/latest` reads; open the same batch in legacy and verify billing details and refund controls load.

# Negative Tests

- Omitted option still hydrates.
- Lightweight mode never calls `getDoc`, including mixed flags.
- Missing billing data does not hide React actions.
- Unauthorized and empty contexts do not load recipients.
- Stored checkout bearer URLs remain absent from the React model.

# Release Gates

Run the two focused root unit tests, the focused app component test, the focused legacy smoke, and the cache-bust guard. GitHub CI remains the full gate.

# Post-Deploy Checks

Compare React Firestore reads against recipient count, confirm legacy detail behavior, and monitor route latency, read volume, and loader warnings.
