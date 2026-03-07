Objective: preserve one-time admin invite semantics by enforcing atomic redemption at the flow boundary.

Current state:
- Validation is read-only.
- Consumption depends on the caller choosing the atomic helper.
- A legacy fallback in `js/accept-invite-flow.js` can reintroduce non-atomic side effects.

Proposed state:
- `processInviteCode()` treats atomic admin redemption as mandatory.

Blast radius comparison:
- Before: any caller omitting the atomic dependency could grant coach access and leave the code reusable.
- After: missing atomic wiring causes a controlled error before any privilege grant.

Controls:
- Single-write ownership remains in `redeemAdminInviteAtomically()` in `js/db.js`.
- The flow layer enforces dependency presence instead of recreating persistence logic.

Rollback:
- Revert the single flow change and test if a caller unexpectedly depends on the fallback.
