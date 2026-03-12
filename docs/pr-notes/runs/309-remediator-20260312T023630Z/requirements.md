Objective: address PR thread PRRT_kwDOQe-T585zwQo7 with the smallest change in the cancel-game flow.
Current state: `edit-schedule.html` awaits `loadSchedule()` before surfacing `result.notificationError`.
Proposed state: cancellation success must still report a chat-notification failure even if the schedule refresh throws.
Risk surface: only the cancel-game click handler on `edit-schedule.html`; no data model or backend behavior changes.
Assumptions: `cancelScheduledGame()` already commits cancellation before returning `{ cancelled: true, notificationError }`; refresh errors should not be reported as cancellation failures.
Recommendation: decouple the partial-success alert from `loadSchedule()` by preserving the warning path even when refresh fails, and surface refresh failure separately if needed.
