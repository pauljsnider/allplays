# Requirements Role Summary

## Objective
Restore user-visible authorization behavior so management UI entry permissions match Firestore write permissions.

## Current vs Proposed
- Current: `hasFullTeamAccess` grants full management access to users in `coachOf`.
- Backend reality: Firestore write gates use `isTeamOwnerOrAdmin` (owner/admin email/global admin), not `coachOf`.
- Proposed: Full management access in UI is limited to owner/admin email/global admin, matching backend write authorization.

## Risk Surface / Blast Radius
- Scope: team management page access decisions and redirects.
- Risk reduced: prevents dead-end UX where users can open edit screens but cannot save.
- Parent access remains unchanged.

## Assumptions
- `coachOf` remains useful for other non-write UX contexts, but not as write-capable management access.
- Rules are the source of truth for write authorization.

## Acceptance Criteria
1. `hasFullTeamAccess` returns false for coach-only users.
2. `getTeamAccessInfo` does not return `full` for coach-only users.
3. Owner/admin email/global admin behavior stays unchanged.
4. Unit tests cover and enforce the alignment.
