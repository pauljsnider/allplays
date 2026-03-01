# Code role output

## Plan
1. Add failing regression assertion in `tests/unit/team-access.test.js` for stale `coachOf` access.
2. Update `js/team-access.js` to remove `coachOf` from full management access decisions.
3. Update `firestore.rules` to remove `coachOf` as admin-equivalent in helper functions.
4. Run targeted test, then full `tests/unit`.
5. Commit with issue reference.

## Conflict resolution synthesis
- Requirements and architecture agree on a single canonical revocation source (`adminEmails`) for team-management authorization.
- QA requires automated coverage; unit tests are added in existing Vitest suite.
- Requested role skills/tooling (`allplays-orchestrator-playbook`, role skills, `sessions_spawn`) are unavailable in this runtime; outputs above are equivalent synthesized artifacts persisted at the required paths.
