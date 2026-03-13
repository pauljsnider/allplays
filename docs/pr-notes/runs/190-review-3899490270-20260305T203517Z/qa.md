# QA Role Notes

Requested orchestration skill/subagent tooling (`allplays-orchestrator-playbook`, `allplays-qa-expert`, `sessions_spawn`) is unavailable in this runtime, so this artifact captures equivalent role output.

## Critical checks
- SW init: registration path posts `ALLPLAYS_INIT_FIREBASE_CONFIG` with required Firebase keys.
- SW click safety: malformed/external-disallowed links resolve to `/`.
- Fanout performance: target resolution path uses `Promise.all` and aggregate flattening.

## Validation plan executed
- Source inspection for removal of inline SW config object.
- Source inspection for link normalization + host/protocol allowlist gate before navigation.
- Source inspection for parallelized async query map in function fanout.
- Syntax checks with `node --check` for changed JS files.

## Residual risk
- End-to-end FCM runtime delivery behavior was not exercised against live Firebase services in this session.
