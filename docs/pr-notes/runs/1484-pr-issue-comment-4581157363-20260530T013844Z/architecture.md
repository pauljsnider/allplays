# Architecture

## Current State
`publishOrganizationScheduleDraft` is a Firebase callable that uses the Admin SDK to write paired game documents under both home and away teams. Because Admin SDK bypasses Firestore rules, this callable is the authorization boundary.

## Decision
Keep the callable as the bulk publish write path, but enforce authorization in this order:
1. Require authenticated callable context.
2. Validate organization ID, schedule ID, draft slots, and slot limit.
3. Fetch caller user and organization team.
4. Require organization admin access with `hasTeamAdminAccess`.
5. Fetch all unique home and away teams.
6. Require every referenced team to exist and remain in the organization owner boundary.
7. Require `hasTeamAdminAccess` for every unique referenced team.
8. Only then create timestamp, batch, refs, and writes.

## Blast Radius
- Without this gate: an organization admin could write games into teams they do not administer if team IDs are supplied.
- With this gate: writes are constrained to teams where the caller is owner, admin email match, or global admin.

## Rollback
Revert the single commit. Existing organization boundary checks remain adjacent, so rollback scope is limited to the additional per-team authorization guard and source regression assertions.
