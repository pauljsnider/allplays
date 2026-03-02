# Requirements Role (Fallback Synthesis)

## Objective
Restore delegated coach (`coachOf`) full management access consistency across team pages.

## User-visible failure
- Delegated coach sees full management navigation on team view context.
- Same user is denied on `edit-team.html` and `edit-roster.html`.

## Required behavior
- If `user.coachOf` includes the current `teamId`, access level must be full-management.
- `Edit Team` and `Edit Roster` must allow delegated coach without requiring owner/adminEmail/platform-admin.
- Existing owner/adminEmail/platform-admin permissions remain unchanged.
- Parent-only access behavior remains unchanged.

## Acceptance checks
1. `hasFullTeamAccess` returns true for coach-assigned user on matching team id.
2. `getTeamAccessInfo` returns `{ hasAccess: true, accessLevel: 'full' }` for coach-assigned user.
3. Team management pages continue wiring through shared access helper.
