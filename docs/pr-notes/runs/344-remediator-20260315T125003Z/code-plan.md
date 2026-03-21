Skill/orchestration note:
- Preferred `allplays-orchestrator-playbook` and role subagent skills were requested, but they are not available as callable tools in this session, and `sessions_spawn` is unavailable. Used inline role analysis instead and persisted the notes here.

Implementation plan:
1. Inspect the rideshare request update rule and the existing re-request unit test.
2. Add `isParentForPlayer(teamId, resource.data.childId)` to the requester-owned re-request branch in `firestore.rules`.
3. Extend `tests/unit/rideshare-rerequest-policy.test.js` to assert the new guard.
4. Run the focused unit test.
5. Stage only the touched files and commit on the current branch.
