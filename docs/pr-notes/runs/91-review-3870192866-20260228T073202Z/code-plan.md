# Code Role Summary

## Minimal Safe Patch
1. Remove unsupported `initialSnapshotLoaded` from `tests/unit/team-chat-last-read.test.js` inputs.
2. Clarify policy in `js/team-chat-last-read.js` doc comment: update on every realtime snapshot when context exists.
3. Run targeted test file.

## Notes
- `allplays-orchestrator-playbook` and `sessions_spawn` are not available in this runtime, so role outputs were captured as traceable artifacts in this run directory.
