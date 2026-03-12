Objective: allow delegated coaches listed in `user.coachOf` to complete the same core team-management flows that the team UI already advertises.

Current state:
- `team.html` and related banner logic present full-access navigation for coach users.
- `edit-team.html` and `edit-roster.html` rely on the shared full-access helper at page entry.
- The shared helper currently excludes delegated coach assignments, so delegated coaches are redirected away from both pages.

Proposed state:
- Treat team-scoped delegated coaches as full-access users for team-management entry checks.
- Keep parent-only access unchanged.

Risk surface and blast radius:
- Blast radius is limited to pages and flows that call `hasFullTeamAccess(...)` or `getTeamAccessInfo(...)`.
- Broadening full access to `coachOf` is intentional and aligns app behavior with delegated coach semantics already used elsewhere.
- Main regression risk is accidentally granting access when the team id is missing or malformed.

Assumptions:
- `coachOf` is the authoritative delegated coach relationship.
- Team-scoped delegated coaches are intended to edit team metadata and roster.
- Existing owner, admin-email, platform-admin, and parent behaviors must remain unchanged.

Recommendation:
- Fix the shared helper instead of adding more page-local exceptions. This is the smallest change that restores control equivalence across all team-management surfaces.

Success measures:
- Delegated coach unit coverage asserts full access and `full` access level for matching `coachOf`.
- Existing owner/admin/parent/unrelated-user coverage still passes.
