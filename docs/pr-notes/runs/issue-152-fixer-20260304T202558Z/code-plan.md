# Code Role (allplays-code-expert equivalent fallback)

Requested orchestration skill `allplays-orchestrator-playbook`, role skill `allplays-code-expert`, and `sessions_spawn` are unavailable in this runtime. This artifact captures equivalent implementation plan.

## Root-cause hypothesis
Rideshare write permission denies parents who are linked via `parentPlayerKeys` but do not have denormalized `parentTeamIds`.

## Conflict resolution across roles
- Requirements asked for minimal behavior change.
- Architecture proposed composite parent check.
- QA required denial guarantees for unlinked users.

Decision: implement a helper `canAccessTeamAsParent` (team-link OR player-link prefix) and use it only in rideshare rules to minimize blast radius while restoring expected parent permissions.

## Planned edits
1. `firestore.rules`: add composite parent helper and replace rideshare path uses of `isParentForTeam` with composite helper.
2. `tests/unit/firestore-rideshare-permissions.test.js`: add failing-first assertion for rideshare rule wiring.
3. Run targeted tests and commit with issue reference.
