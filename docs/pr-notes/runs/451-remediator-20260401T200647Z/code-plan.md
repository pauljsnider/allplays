1. Remove `validateAccessCode` from the `parent-dashboard.html` imports if it is no longer used.
2. Delete the dashboard handler block that throws on `!validation.valid` before `redeemParentInvite(...)`.
3. Update `tests/unit/parent-dashboard-redeem-code-wiring.test.js` so it asserts direct redemption wiring and guards against reintroducing the pre-validation call in this handler.
4. Run the targeted Vitest file, then stage and commit the scoped changes.
