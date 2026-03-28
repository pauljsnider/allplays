Objective: close the two unresolved PR review threads for admin invite redemption with the smallest reviewable change.

Current state:
- `js/signup-flow.js` and `js/auth.js` already call `redeemAdminInviteAcceptance(...)` with the new object signature on this branch.
- `js/db.js` re-checks `used` and team/type inside `redeemAdminInviteAtomicPersistence(...)`, but does not re-check `expiresAt` before marking the invite used.

Required outcome:
- Preserve the updated caller signature.
- Restore fail-closed expiration enforcement at the atomic write step for admin invites.

Assumptions:
- The prior caller-signature comment can be addressed by confirming the branch already includes the fix.
- Minimal scope means no broader refactor of the invite redemption flow.
