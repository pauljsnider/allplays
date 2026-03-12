Current state vs proposed state: UI success path is serialized as cancel -> refresh -> optional warning. Proposed order is cancel -> best-effort warning capture + refresh handling, without letting refresh failure erase the committed-result message.
Blast radius: one DOM event handler in `edit-schedule.html`; no API contract changes.
Controls: keep `cancelScheduledGame()` as source of truth, avoid refactor, and catch refresh errors locally so the user receives accurate outcome reporting.
Rollback: revert the single handler change.
