Current state:
- `accept-invite.html` uses `redeemAdminInviteAtomically(...)` through `js/accept-invite-flow.js`.
- `js/auth.js` email/password signup still imports `js/admin-invite.js`, which performs multi-step profile/team/code writes itself.

Proposed state:
- `js/admin-invite.js` becomes a thin adapter over `redeemAdminInviteAtomicPersistence(...)` in `js/db.js`.
- `js/auth.js` keeps the same call site, but the persistence path becomes equivalent to direct invite acceptance.

Controls comparison:
- Better than current: admin email append, coach role grant, and code consumption stay in the same guarded persistence helper.
- Blast radius stays limited to `admin_invite` redemptions.

Rollback:
- Revert the helper delegation and cache-bust version bumps.

Instrumentation:
- Unit tests should prove the signup helper delegates atomic persistence and normalizes the user email before grant.
