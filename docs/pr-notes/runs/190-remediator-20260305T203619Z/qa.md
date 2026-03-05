# QA Role Notes

Focus validation:
- Push registration still returns FCM token after SW config handoff.
- Background notification displays title/body and stores sanitized link data.
- Notification clicks only open allowed paths/domains; invalid links route to `/`.
- Notification delivery logic still excludes actor UID and respects preferences.

Manual checks:
- Run any available functions lint/tests.
- Verify changed files have no syntax errors.

Residual risk:
- Runtime Firebase config availability depends on registration path posting config at least once for non-Firebase-Hosting environments.
