Test strategy:
- Add a focused unit test that extracts the cancel-game button handler from `edit-schedule.html` and executes it with mocks.

Primary regression:
- When `cancelGame(...)` resolves and `postChatMessage(...)` rejects, the handler should still call `loadSchedule()` and alert a notification-specific message instead of `Error cancelling game`.

Guardrail:
- When `cancelGame(...)` rejects, the handler should still surface the existing cancellation error and skip chat posting.

Manual spot check after patch:
- Cancel a game from `edit-schedule.html`.
- Confirm the schedule refreshes even if the chat write is blocked.
- Confirm the alert text distinguishes cancellation success from notification failure.
