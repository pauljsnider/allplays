# Requirements Role (allplays-requirements-expert)

## Objective
Fix admin invite acceptance so invited coaches reliably retain access across multiple teams and team admin identity is persisted for authorization checks.

## Current vs Proposed
- Current: Admin invite flow lowercases and appends email in-memory but never writes `teams/{teamId}.adminEmails`.
- Current: Admin invite flow writes `coachOf: [teamId]`, replacing any existing teams.
- Proposed: Persist `adminEmails` to team when missing and merge `coachOf` with existing user teams.

## Risk Surface and Blast Radius
- Surface: `accept-invite.html` admin invite redemption path and `users/` + `teams/` writes.
- Current blast radius: coach loses prior team access; team-level admin checks may fail due to missing `adminEmails` persistence.
- Proposed blast radius: limited to invite redemption transaction; no auth-rule or schema changes.

## Assumptions
- `updateTeam(teamId, { adminEmails })` is the canonical write path for team doc updates.
- Existing role semantics allow additive role merge (`coach` added without removing existing roles).

## Recommendation
Ship minimal additive fix: persist team admin email when newly invited, merge coach team memberships, preserve existing roles, and keep access code single-use marking unchanged.

## Success Criteria
- Admin invite persists user email into `teams/{teamId}.adminEmails` when absent.
- Existing `users/{uid}.coachOf` entries remain after accepting another admin invite.
- Access code is still marked used exactly once after success.
