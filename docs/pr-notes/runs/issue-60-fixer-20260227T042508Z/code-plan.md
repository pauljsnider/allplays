# Code Role Plan

## Implementation Scope
- `js/db.js`: add `redeemAdminInvite` helper.
- `accept-invite.html`: call helper instead of local no-op admin array mutation.
- `tests/unit/admin-invite-redemption.test.js`: new unit coverage with mocked Firebase primitives.

## Constraints
- Keep patch minimal and targeted to issue #60.
- No unrelated refactors.
- Preserve existing user-facing success copy and redirects.

## Validation Command
- Run targeted vitest file(s), then run full `tests/unit` suite if time allows.
