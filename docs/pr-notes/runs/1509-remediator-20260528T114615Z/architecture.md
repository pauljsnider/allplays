# Architecture Decisions

- Treat timezone as required for detailed schedule date/time notification formatting.
- Resolve timezone from `afterGame.timeZone || beforeGame.timeZone`; do not default to UTC for schedule update payloads.
- Keep notification body truncation and category routing unchanged.
- Rollback is limited to the notification payload helper and its unit tests.
