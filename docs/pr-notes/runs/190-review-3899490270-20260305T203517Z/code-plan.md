# Code Role Notes

Requested orchestration skill/subagent tooling (`allplays-orchestrator-playbook`, `allplays-code-expert`, `sessions_spawn`) is unavailable in this runtime, so this artifact captures equivalent role output.

## Implemented patch scope
1. `firebase-messaging-sw.js`
- Removed hardcoded `firebase.initializeApp({...})` literals.
- Added runtime config resolution from hosting endpoint + cache and message-based config bootstrap.
- Added notification link normalization/allowlist validation before opening windows.

2. `js/push-notifications.js`
- Added worker config handoff during registration using app options from `getApp()`.

3. `functions/index.js`
- Reworked `getTargetsForCategory` to parallelize per-user reads with `Promise.all` and flatten results.

## Out of scope
- Firestore rules and UI preference semantics remain unchanged.
- No new unit tests added because this branch lacks a local runnable package/toolchain for executing browser-SW integration tests.
