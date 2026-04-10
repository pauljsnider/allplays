## Test Strategy

1. Add a dashboard wiring test that proves the manual redeem button validates codes before calling `redeemParentInvite()`.
2. Extend the existing parent invite atomic guard test so it explicitly checks for the expiry guard inside the transaction.
3. Run the targeted Vitest files first, then the full unit suite if the targeted slice passes cleanly.

## Regression Focus

- Expired parent invite entered manually on `parent-dashboard.html`
- Prevention of success/reload behavior when validation fails
- Persistence guard remains inside the transaction even if UI behavior changes later

## Residual Risk

- These are source/wiring tests, not browser E2E tests, so they verify control placement rather than a rendered alert dialog.
- The DB-level test is intentionally lightweight and structural because `js/db.js` is tightly coupled to Firebase globals.
