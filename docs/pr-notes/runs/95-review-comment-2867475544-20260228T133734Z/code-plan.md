# Code Role (Fallback Synthesis)

## Tooling status
Requested skills `allplays-orchestrator-playbook` / `allplays-code-expert` and `sessions_spawn` are not available in this runtime; this file records equivalent code plan.

## Plan
1. Patch `js/utils.js` day-number calculations in `expandRecurrence()` to use `getTime()`.
2. Run focused checks (grep + small Node harness) for weekly interval behavior around DST.
3. Commit and push on PR head branch.

## Conflict resolution across roles
- All roles align on a minimal two-line fix.
- No competing proposals required reconciliation.
