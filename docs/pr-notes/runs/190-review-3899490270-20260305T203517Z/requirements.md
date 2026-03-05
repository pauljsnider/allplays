# Requirements Role Notes

Requested orchestration skill/subagent tooling (`allplays-orchestrator-playbook`, `allplays-requirements-expert`, `sessions_spawn`) is unavailable in this runtime, so this artifact captures equivalent role output.

## Objective
Address PR #190 review blockers by removing service-worker hardcoded Firebase config, preventing notification click open redirects, and reducing notification fanout latency.

## Current state
- `firebase-messaging-sw.js` contained inline Firebase app config values.
- Notification click handler opened payload-provided links without trust validation.
- `getTargetsForCategory` performed sequential per-user Firestore preference/device reads.

## Proposed state
- Service worker initializes Firebase config from runtime-injected + cached config (and hosting fallback), not hardcoded literals.
- Service worker opens only validated links constrained to approved hosts/protocols, otherwise falls back to `/`.
- Cloud Function fanout target resolution parallelizes per-user preference/device queries using `Promise.all`.

## Success criteria
- No inline Firebase config literals remain in `firebase-messaging-sw.js`.
- Notification click path rejects untrusted/malformed links.
- Fanout query path no longer scales as strict sequential O(N) latency.
