Current state:
- The cancel-game button handler performs `cancelGame(...)` and `postChatMessage(...)` inside one `try/catch`.
- Because Firestore writes are non-atomic across those collections, the second write can fail after the game is already cancelled.

Proposed state:
- Keep `cancelGame(...)` in the primary `try/catch`.
- Move `postChatMessage(...)` into a nested `try/catch` after cancellation succeeds.
- Call `loadSchedule()` after the nested notification attempt so the UI reflects the persisted cancelled status.

Controls:
- Blast radius stays page-local.
- Cancellation failure path remains unchanged.
- Notification failure is logged and surfaced without rolling back or misreporting persisted state.
