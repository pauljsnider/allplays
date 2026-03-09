Decision: fix the mismatch at the shared client authorization helper, not in Firestore rules or write APIs.

Why:
- The review identifies a client-side access broadening that is inconsistent with persisted-write authorization.
- Broadening backend writes for delegated coaches would materially change blast radius and control semantics.
- Removing `coachOf` from `hasFullTeamAccess` is the smallest control-preserving change.

Current state vs proposed state:
- Current: `hasFullTeamAccess` = owner OR delegated coach OR admin email OR platform admin.
- Proposed: `hasFullTeamAccess` = owner OR admin email OR platform admin.

Controls:
- Firestore remains the source of truth for write authorization.
- Client gating now matches `isTeamOwnerOrAdmin(teamId)` semantics for these edit flows.

Rollback:
- Revert the helper/test change if product requirements later decide delegated coaches should have write access and backend rules are updated to match.
