# Requirements Role Notes

Objective: remediate unresolved PR #190 review threads for push-notification security and notification target performance.

Scope:
- `firebase-messaging-sw.js`: remove hardcoded Firebase config dependency and enforce safe notification link handling.
- `functions/index.js`: remove sequential per-user notification preference/device query latency pattern.

Acceptance criteria:
- Service worker initializes Firebase from runtime-provided config (not inline literals).
- Notification click targets are validated to trusted/same-origin URLs and fallback safely.
- Notification target discovery uses concurrent user query execution to reduce end-to-end latency.
