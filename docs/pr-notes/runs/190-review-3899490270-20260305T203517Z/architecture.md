# Architecture Role Notes

Requested orchestration skill/subagent tooling (`allplays-orchestrator-playbook`, `allplays-architecture-expert`, `sessions_spawn`) is unavailable in this runtime, so this artifact captures equivalent role output.

## Risk surface and blast radius
- Scope is limited to push notification subsystem (`firebase-messaging-sw.js`, `js/push-notifications.js`) and notification dispatch in `functions/index.js`.
- No Firestore schema/rules changes in this patch; runtime behavior only.

## Control equivalence
- Credentials handling: move from source-literal config in SW to dynamic config load with cache, reducing static exposure in this critical file.
- URL navigation control: enforce protocol/host allowlist before `clients.openWindow`.
- Throughput control: preserve filtering semantics while parallelizing independent per-user reads.

## Tradeoffs
- If hosting config endpoint is unavailable and no cached/runtime config exists, SW background handling is unavailable until next foreground registration provides config.
- Parallel fanout queries trade lower latency for higher concurrent Firestore read load; acceptable for this trigger path.
