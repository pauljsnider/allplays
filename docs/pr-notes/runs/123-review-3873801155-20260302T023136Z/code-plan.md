# Code Role Plan and Outcome

## Planned Patch
- Update `hasFullTeamAccess(user, team)` to include delegated coach check with guarded `team.id`.
- Extend `tests/unit/team-access.test.js` with explicit missing-team-id denial case.

## Implemented Patch
- Added `teamId` normalization and `isCoach` condition:
  - `teamId !== ''`
  - `Array.isArray(user.coachOf)`
  - `user.coachOf.includes(teamId)`
- Updated return condition to include `isCoach`.
- Added unit test: `does not grant coach access when team id is missing`.

## Notes
Requested role orchestration skill `allplays-orchestrator-playbook` and role skills were not available in-session, so this artifact set captures manual role synthesis with equivalent outputs.
