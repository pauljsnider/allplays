## Role
QA synthesis fallback for issue #256.

## Regression Guardrails
- Add a unit test for the orchestration helper:
  - cancellation succeeds, notification fails
  - helper resolves instead of rejects
  - helper reports cancellation success and includes notification error
- Verify the existing fatal path remains fatal:
  - cancellation fails
  - notification is not attempted
  - helper rejects

## Manual Checks
- Cancel a game with chat working: game cancelled, chat message posted, schedule reloads.
- Cancel a game with chat failing: game cancelled, schedule reloads, user sees notification-specific warning.
