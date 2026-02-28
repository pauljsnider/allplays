# Code role output (manual fallback)

Implementation plan:
1. Add `isAccessCodeExpired(expiresAt, nowMs = Date.now())` in `js/access-code-utils.js`.
2. Add `tests/unit/access-code-utils.test.js` covering expired/non-expired/no-expiration cases.
3. Import helper in `js/db.js` and enforce in `redeemParentInvite` immediately after loading code data.
4. Keep error text aligned with existing patterns: `Code has expired`.
