Current state:
- `redeemAdminInviteAtomically()` is the write control point and persists `team.adminEmails`.
- `dashboard.html` queries `getUserTeamsWithAccess(user.uid, user.email)`.
- `hasFullTeamAccess()` evaluates only `user.email`.

Proposed state:
- Normalize a shared user email from `user.email` or `user.profileEmail`.
- Have `checkAuth()` hydrate `profileEmail` and backfill `user.email` when auth email is absent.
- Have `dashboard.html` query with `profile.email || user.email`.

Why this path:
- Minimal change.
- Preserves the existing authorization model.
- Aligns read-time discovery/access with the invite flow's persisted profile data.

Rollback:
- Revert the fallback assignments in `auth.js`, `dashboard.html`, and `team-access.js`.
