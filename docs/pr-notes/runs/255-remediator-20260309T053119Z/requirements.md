Objective: align client-side full team-management access with backend authorization for PR #255 review thread `PRRT_kwDOQe-T585y7PeC`.

Current state:
- `js/team-access.js` grants full access when `user.coachOf` includes the team id.
- `edit-team.html` and `edit-roster.html` rely on that helper for page entry.
- `js/db.js` writes (`updateTeam`, `addPlayer`, `updatePlayer`) and `firestore.rules` still require owner/admin-email/global-admin via `isTeamOwnerOrAdmin`.

Proposed state:
- Shared full-access helper only authorizes owner, admin email, or platform admin.
- Delegated coach metadata in `coachOf` no longer opens edit flows that cannot be saved.

Acceptance criteria:
1. A user whose only entitlement is `coachOf` does not receive `hasFullTeamAccess(...)`.
2. `getTeamAccessInfo(...)` does not classify `coachOf`-only users as `full`.
3. Owner, team admin email, and platform admin access remain unchanged.

Risk surface and blast radius:
- Narrow frontend authorization change in one helper used by edit-page gating and banner access classification.
- This intentionally removes a broken path rather than changing Firestore write permissions.

Assumptions:
- PR feedback scope is limited to preventing the broken edit/save path, not expanding delegated coach backend writes.
