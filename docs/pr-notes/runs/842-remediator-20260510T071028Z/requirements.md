# Requirements

## Acceptance Criteria
- Private team calendar feed access must be based on current team membership/admin state, not stale role flags stored on the calendar token document.
- A token holder removed from the team must receive `403 Calendar token no longer has team access` even if the token document still has `roles: ['member']`, `roles: ['admin']`, `member: true`, or token-scoped team links.
- Existing valid access continues for current team owners, current `team.adminEmails`, and current user `parentTeamIds`.

## Scope
- Minimal change in `functions/index.js` membership validation only.
