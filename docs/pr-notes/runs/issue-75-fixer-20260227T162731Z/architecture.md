# Architecture role output

## Root cause
Authorization logic uses two independent grants for team management:
1) `teams/{teamId}.adminEmails`
2) `users/{uid}.coachOf`

The edit-team revoke flow updates only (1), so stale (2) keeps write-capable access.

## Minimal design
- Remove `coachOf` from full-access helper (`js/team-access.js`) used by management UIs.
- Remove `isCoachForTeam(teamId)` from `isTeamOwnerOrAdmin(teamId)` and related owner/admin checks in `firestore.rules`.
- Keep `coachOf` data untouched to avoid migration complexity; it is no longer an authorization source.

## Blast radius
- Medium-low: access checks for management tighten to explicit owner/admin/global-admin only.
- No schema changes or migrations.

## Control equivalence
- Revocation becomes deterministic from one canonical source (`adminEmails`) plus ownership/admin.
- Eliminates privilege persistence from denormalized profile state.

## Rollback
Revert the rule/helper changes to restore previous `coachOf`-based grants.
