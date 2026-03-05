# Requirements Role (fallback synthesis)

## Note
Requested skill/subagent lane `allplays-requirements-expert` was not available in this runtime. This is a main-lane synthesis.

## Objective
Ensure accepting an admin invite always grants real team-management access.

## User-visible acceptance criteria
- After invite acceptance success, invited admin can open `edit-team.html#teamId=<teamId>`.
- After invite acceptance success, invited admin can open `edit-roster.html#teamId=<teamId>`.
- Team appears in dashboard/team lists that rely on `teams.adminEmails` queries.

## Constraints
- Keep fix minimal and isolated to invite acceptance persistence path.
- Preserve existing success UX and redirect behavior.
- Prefer fail-closed behavior if persistence prerequisites are missing.

## Risks and blast radius
- High user impact if team admin membership is not persisted.
- Blast radius limited to admin invite acceptance flow.
