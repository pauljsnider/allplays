Test focus: regression guard for repeated admin invite redemption risk.

Coverage added:
- `tests/unit/accept-invite-flow.test.js`

Cases:
- Admin invite uses `redeemAdminInviteAtomically()` when available.
- Admin invite errors propagate from the atomic helper.
- Admin invite fails closed when atomic redemption is unavailable.
- Validation failures do not trigger redemption.

Manual risk notes:
- Main production page already passes the atomic helper, so runtime behavior should remain unchanged except for unsupported misconfiguration cases.

Validation command:
- `npm test -- tests/unit/accept-invite-flow.test.js tests/unit/admin-invite-redemption.test.js tests/unit/admin-invite-atomic-persistence-guard.test.js`
