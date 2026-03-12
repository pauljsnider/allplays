Objective: repair a permission mismatch between team navigation and page-entry gating.

Current architecture:
- Team access decisions are centralized in `js/team-access.js`.
- Team page/banner consumers use `getTeamAccessInfo(...)` to decide whether to show coach/admin navigation.
- Edit pages call `hasFullTeamAccess(...)` directly for enforcement.

Root cause:
- The shared helper omits `user.coachOf.includes(team.id)`.
- Because both edit pages consume the shared helper, the mismatch is systemic rather than page-specific.

Proposed change:
- Extend `hasFullTeamAccess(...)` to recognize delegated coach membership only when a concrete team id is present.
- Let `getTeamAccessInfo(...)` inherit the corrected behavior without extra branching.

Why this path:
- One-source fix, minimal blast radius, no duplicated permission logic.
- Preserves existing redirects and page flow while aligning all consumers on the same access contract.

Controls and rollback:
- Control equivalence improves because UI affordances and page-entry enforcement now match.
- Rollback is a single helper revert if unexpected access expansion is observed.
