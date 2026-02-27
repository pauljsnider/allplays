# Architecture role synthesis (fallback single-agent)

Requested subagent skill `allplays-architecture-expert` was not available in local skills list.

## Root cause
Invite generation depends on existing `teamId` (`inviteAdmin(teamId, email)`), but create-team flow has no ID until persistence completes.

## Minimal design
1. Track pending admin invites while editing a new team draft.
2. On `createTeam()` success, process pending emails:
   - call `inviteAdmin(newTeamId, email)`
   - attempt `sendInviteEmail(email, code, 'admin', { teamName })` when the invite is for a new user
3. Aggregate results and notify coach if any invite emails fail or fallback codes need sharing.

## Blast radius
- Limited to `edit-team.html` invite workflow and one new helper module for deterministic unit tests.
- No schema/rules changes.

## Control preservation
- Uses existing invite code generation/validation mechanism.
- Does not bypass auth or access checks.
