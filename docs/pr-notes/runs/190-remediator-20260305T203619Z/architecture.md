# Architecture Role Notes

Current state:
- Push service worker consumed static Firebase web config and opened notification links directly.
- Cloud Function queried notification targets in a loop with per-user awaited reads.

Proposed state:
- SW bootstraps Firebase config from runtime sources (Firebase Hosting init JSON or posted app config), with cache fallback.
- SW normalizes links via URL parsing and allowlist checks before `clients.openWindow`.
- Cloud Function gathers per-user notification data concurrently via batched async tasks.

Risk and blast radius:
- Limited to web push initialization/click behavior and notification fanout path.
- No schema changes; low rollback cost by reverting touched files.
