# Patch Plan
1. Introduce `redeemAdminInviteAtomicPersistence` in `js/db.js` using Firestore `writeBatch` for all admin invite writes.
2. Inject this atomic helper into `redeemAdminInviteAcceptance` and fail closed if not supplied.
3. Remove non-atomic write dependencies from `accept-invite.html` admin-invite callsite.
4. Update unit tests to validate atomic callback contract and missing-callback guard.

# Code Changes Applied
- Added `redeemAdminInviteAtomicPersistence` in `js/db.js` using one Firestore `writeBatch` commit for team/user/access-code writes.
- Updated `js/admin-invite-redemption.js` to require and use the atomic persistence callback.
- Updated `accept-invite.html` admin invite path to inject `redeemAdminInviteAtomicPersistence` and removed non-atomic write callbacks.
- Updated `tests/unit/admin-invite-redemption.test.js` for atomic contract assertions and missing-callback fail-closed behavior.

# Validation Run
- `pnpm dlx vitest run tests/unit/admin-invite-redemption.test.js` passed (3/3 tests).

# Residual Risks
- `sessions_spawn` subagent orchestration runtime is unavailable in this environment; role outputs are persisted directly in this run directory as fallback artifacts.

# Commit Message Draft
Use atomic batch for admin invite acceptance writes
